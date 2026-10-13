using System.Collections.Concurrent;
using System.Text.Json;
using GuessNumber.Engine;
using GuessNumber.Server.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;

namespace GuessNumber.Server.Services;

public sealed class SecretProtector(IDataProtectionProvider provider)
{
    private readonly IDataProtector _protector = provider.CreateProtector("GuessNumber.Secrets.v1");

    public string Protect(string value) => _protector.Protect(value);
    public string Unprotect(string payload) => _protector.Unprotect(payload);
}

public sealed class JwtOptions
{
    public string Issuer { get; set; } = "guessnumber";
    public string Audience { get; set; } = "guessnumber";
    public string Key { get; set; } = "";
}

public interface IPresence
{
    Task OnlineAsync(string userId, string connectionId);
    Task OfflineAsync(string connectionId);
    Task<IReadOnlyCollection<string>> OnlineUserIdsAsync();
}

public sealed class MemoryPresence : IPresence
{
    private readonly ConcurrentDictionary<string, string> _byConnection = new();

    public Task OnlineAsync(string userId, string connectionId)
    {
        _byConnection[connectionId] = userId;
        return Task.CompletedTask;
    }

    public Task OfflineAsync(string connectionId)
    {
        _byConnection.TryRemove(connectionId, out _);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyCollection<string>> OnlineUserIdsAsync() =>
        Task.FromResult<IReadOnlyCollection<string>>(_byConnection.Values.Distinct().ToArray());
}

public sealed class RedisPresence(IConnectionMultiplexer redis) : IPresence
{
    public async Task OnlineAsync(string userId, string connectionId)
    {
        var db = redis.GetDatabase();
        await db.StringSetAsync($"presence:{userId}", connectionId, TimeSpan.FromMinutes(2));
        await db.SetAddAsync("presence:users", userId);
    }

    public async Task OfflineAsync(string connectionId)
    {
        var db = redis.GetDatabase();
        foreach (var userId in await OnlineUserIdsAsync())
        {
            var current = await db.StringGetAsync($"presence:{userId}");
            if (current == connectionId)
            {
                await db.KeyDeleteAsync($"presence:{userId}");
                await db.SetRemoveAsync("presence:users", userId);
            }
        }
    }

    public async Task<IReadOnlyCollection<string>> OnlineUserIdsAsync()
    {
        var values = await redis.GetDatabase().SetMembersAsync("presence:users");
        return values.Select(v => v.ToString()).ToArray();
    }
}

public sealed class LobbyQueue
{
    private readonly ConcurrentQueue<string> _waiting = new();

    public bool TryPair(string userId, out string partner)
    {
        while (_waiting.TryDequeue(out var next))
        {
            if (next != userId)
            {
                partner = next;
                return true;
            }
        }

        partner = "";
        return false;
    }

    public void Enqueue(string userId) => _waiting.Enqueue(userId);
}

public sealed class LiveGame
{
    public Guid Id { get; init; }
    public Game Game { get; init; } = null!;
    public string?[] Users { get; } = new string?[2];
    public PolicySolver? Solver { get; set; }
    public int SolverSeed { get; init; }
    public SemaphoreSlim Gate { get; } = new(1, 1);
}

public sealed class LiveGames
{
    private readonly ConcurrentDictionary<Guid, LiveGame> _games = new();
    private readonly ConcurrentDictionary<string, string> _invites = new();

    public void Add(LiveGame game) => _games[game.Id] = game;

    public LiveGame? Find(Guid id) => _games.GetValueOrDefault(id);

    public LiveGame? ActiveFor(string userId) =>
        _games.Values.FirstOrDefault(g => g.Users.Contains(userId) && g.Game.Phase != GamePhase.Finished);

    public string CreateInvite(Guid gameId, string fromUserId, string toUserId)
    {
        var id = Guid.NewGuid().ToString("N");
        _invites[id] = fromUserId + "|" + toUserId + "|" + gameId;
        return id;
    }

    public bool TakeInvite(string inviteId, string respondingUserId, out string fromUserId, out Guid gameId)
    {
        fromUserId = "";
        gameId = Guid.Empty;
        if (!_invites.TryRemove(inviteId, out var payload))
            return false;
        var parts = payload.Split('|');
        if (parts.Length != 3 || parts[1] != respondingUserId || !Guid.TryParse(parts[2], out gameId))
        {
            _invites[inviteId] = payload;
            return false;
        }

        fromUserId = parts[0];
        return true;
    }
}

public sealed class GameSettingsDto
{
    public string Ruleset { get; set; } = "classic4";
    public string NumberChange { get; set; } = NumberChangeModes.Once;
    public int ChangeCost { get; set; } = 25;
    public int ChangeDigits { get; set; } = 2;
    public bool NotifyOnChange { get; set; } = true;
    public bool ChangeConsumesTurn { get; set; } = true;
    public int TurnTimerSec { get; set; } = 60;
    public bool EqualTurns { get; set; }
    public OpponentDto? Opponent { get; set; }
}

public sealed class OpponentDto
{
    public string Kind { get; set; } = "human";
    public string Agent { get; set; } = AgentNames.Swor;
    public bool Per { get; set; }
    public bool AllowComputerChange { get; set; } = true;
    public string ChangePolicy { get; set; } = ChangePolicies.Never;
}

public static class SettingsMapper
{
    public static GameSettings ToSettings(GameSettingsDto dto)
    {
        OpponentSettings opponent = dto.Opponent is { Kind: "computer" } computer
            ? new OpponentSettings.Computer(computer.Agent, computer.Per, computer.AllowComputerChange, computer.ChangePolicy)
            : new OpponentSettings.Human();

        return new GameSettings(
            dto.Ruleset,
            dto.NumberChange,
            dto.ChangeCost,
            dto.ChangeDigits,
            dto.NotifyOnChange,
            dto.ChangeConsumesTurn,
            dto.TurnTimerSec,
            dto.EqualTurns,
            opponent);
    }
}

/// <summary>
/// DQN agents load an ONNX policy when a file is present and otherwise play by sampling without replacement.
/// </summary>
public sealed class PolicySolver : ISolver
{
    private readonly SworSolver _fallback = new();
    private readonly string? _modelPath;

    public PolicySolver(string agent, bool per, string contentRoot)
    {
        if (agent == AgentNames.Swor)
            return;

        // TODO Phase 4: load this file with ONNX Runtime. The native package download stalled in this environment,
        // so a missing or present model both play through SworSolver until the runtime is referenced.
        var path = Path.Combine(contentRoot, "models", $"{agent}-{(per ? "per" : "uniform")}.onnx");
        if (File.Exists(path))
            _modelPath = path;
    }

    public bool UsingFallback => _modelPath is null;

    public void Reset(Ruleset ruleset, int seed) => _fallback.Reset(ruleset, seed);

    public string NextGuess()
    {
        // TODO Phase 4 exports the R1 mask as the ONNX input. Until that contract is loaded, SworSolver moves.
        return _fallback.NextGuess();
    }

    public void Observe(string guess, int dead, int wounded)
    {
        if (_fallback is SworSolver)
            _fallback.Observe(guess, dead, wounded);
    }

    public void StampTurn(int turn) => _fallback.StampTurn(turn);

    public void OnOpponentChange(int? turn) => _fallback.OnOpponentChange(turn);

    public SolverStats Stats() => _fallback.Stats();
}

public sealed record GameSnapshot(Guid GameId, PublicGameView State);

public sealed class GameRepository(AppDbContext db, SecretProtector protector)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task SaveAsync(LiveGame live)
    {
        var entity = await db.Games.Include(g => g.Moves).FirstOrDefaultAsync(g => g.Id == live.Id);
        if (entity is null)
        {
            entity = new GameEntity { Id = live.Id, CreatedUtc = DateTimeOffset.UtcNow };
            db.Games.Add(entity);
        }

        var game = live.Game;
        entity.SettingsJson = JsonSerializer.Serialize(game.Settings, Json);
        entity.Status = game.Phase.ToString();
        entity.Player0Id = live.Users[0] ?? "";
        entity.Player1Id = live.Users[1];
        entity.Secret0Protected = game.Secrets[0] is null ? null : protector.Protect(game.Secrets[0]!);
        entity.Secret1Protected = game.Secrets[1] is null ? null : protector.Protect(game.Secrets[1]!);
        entity.SecretHistoryProtected = protector.Protect(JsonSerializer.Serialize(new[]
        {
            game.SecretHistory(0),
            game.SecretHistory(1)
        }));
        entity.Score0 = game.Scores[0];
        entity.Score1 = game.Scores[1];
        entity.Turn = game.Turn;
        entity.CurrentPlayer = game.CurrentPlayer;
        entity.WinnerId = game.Winner is int winner ? live.Users[winner] : null;
        entity.SolverSeed = live.SolverSeed;

        for (var i = entity.Moves.Count; i < game.Moves.Count; i++)
        {
            var move = game.Moves[i];
            entity.Moves.Add(new MoveEntity
            {
                GameId = live.Id,
                Turn = move.Turn,
                Player = move.Player,
                Kind = move.Kind.ToString().ToLowerInvariant(),
                Guess = move.Guess,
                Dead = move.Dead,
                Wounded = move.Wounded,
                PointsDelta = move.PointsDelta,
                RevisitedPreviousSecret = move.RevisitedPreviousSecret
            });
        }

        await db.SaveChangesAsync();
    }
}

public static class ComputerDirector
{
    public static void Play(LiveGame live)
    {
        if (live.Solver is null || live.Game.Settings.ResolvedOpponent is not OpponentSettings.Computer computer)
            return;

        const int seat = 1;
        var game = live.Game;
        if (game.Phase is not (GamePhase.InProgress or GamePhase.FinalTurn) || game.CurrentPlayer != seat)
            return;

        if (computer.AllowComputerChange && computer.ChangePolicy == ChangePolicies.Heuristic && ShouldChange(game, seat))
        {
            var (positions, digits) = Choose(game.Secrets[seat]!, game.Rules);
            var changed = game.ChangeSecret(seat, positions, digits);
            if (changed.Ok)
                return;
        }

        var guess = live.Solver.NextGuess();
        var turn = game.Turn;
        var result = game.SubmitGuess(seat, guess);
        if (!result.Ok || result.Value is null)
            return;

        live.Solver.StampTurn(turn);
        live.Solver.Observe(guess, result.Value.Dead ?? 0, result.Value.Wounded ?? 0);
    }

    public static void NoteHumanChange(LiveGame live, int turn)
    {
        if (live.Solver is null)
            return;
        if (live.Game.Settings.NotifyOnChange)
            live.Solver.OnOpponentChange(turn);
    }

    private static bool ShouldChange(Game game, int seat)
    {
        if (game.Settings.NumberChange == NumberChangeModes.Disabled)
            return false;
        if (game.Settings.NumberChange == NumberChangeModes.Once && game.ChangesUsed[seat] >= 1)
            return false;
        if (game.Scores[seat] < game.Settings.ChangeCost || game.Phase == GamePhase.FinalTurn)
            return false;

        var bestDead = 0;
        var consistent = game.Rules.AllCodes.ToList();
        foreach (var move in game.Moves.Where(m => m.Kind == MoveKind.Guess && m.Player != seat))
        {
            bestDead = Math.Max(bestDead, move.Dead ?? 0);
            consistent = consistent.Where(code =>
            {
                var score = Scorer.Score(move.Guess!, code);
                return score.Dead == move.Dead && score.Wounded == move.Wounded;
            }).ToList();
        }

        return bestDead >= 3 || consistent.Count <= 6;
    }

    private static (int[] Positions, char[] Digits) Choose(string secret, Ruleset rules)
    {
        int[] bestPositions = [0, 1];
        char[] bestDigits = [secret[0], secret[1]];
        var bestDistance = -1;
        var chars = secret.ToCharArray();
        for (var i = 0; i < secret.Length; i++)
        {
            for (var j = i + 1; j < secret.Length; j++)
            {
                for (var d1 = rules.MinDigit; d1 <= rules.MaxDigit; d1++)
                {
                    for (var d2 = rules.MinDigit; d2 <= rules.MaxDigit; d2++)
                    {
                        chars[i] = (char)('0' + d1);
                        chars[j] = (char)('0' + d2);
                        var candidate = new string(chars);
                        if (!Validator.IsValid(candidate, rules))
                            continue;
                        var distance = candidate.Where((ch, index) => ch != secret[index]).Count();
                        if (distance != 2 || distance <= bestDistance)
                            continue;
                        bestDistance = distance;
                        bestPositions = [i, j];
                        bestDigits = [chars[i], chars[j]];
                    }
                }

                chars[i] = secret[i];
                chars[j] = secret[j];
            }
        }

        return (bestPositions, bestDigits);
    }
}
