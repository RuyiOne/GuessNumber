using GuessNumber.Engine;
using GuessNumber.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GuessNumber.Server.Hubs;

public interface IGameClient
{
    Task GameState(GameSnapshot snapshot);
    Task OpponentChangedSecret(int turn);
    Task Chat(string userId, string text, DateTimeOffset sentAt);
    Task Invite(string inviteId, string fromUserId);
    Task Error(string code, string message);
    Task QueueJoined(int waiting);
}

[Authorize]
public sealed class GameHub(
    LiveGames liveGames,
    LobbyQueue queue,
    GameRepository repository,
    IPresence presence,
    IWebHostEnvironment environment) : Hub<IGameClient>
{
    public override async Task OnConnectedAsync()
    {
        var userId = RequireUser();
        await presence.OnlineAsync(userId, Context.ConnectionId);
        var active = liveGames.ActiveFor(userId);
        if (active is not null)
            await Groups.AddToGroupAsync(Context.ConnectionId, Group(active.Id));
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.UserIdentifier is not null)
            await presence.OfflineAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<GameSnapshot> CreateGame(GameSettingsDto settings)
    {
        var userId = RequireUser();
        GameSettings gameSettings;
        try
        {
            gameSettings = SettingsMapper.ToSettings(settings);
            gameSettings.Validate();
        }
        catch (ArgumentException ex)
        {
            throw new HubException("INVALID_SETTINGS:" + ex.Message);
        }

        var seed = Random.Shared.Next();
        var game = new Game(gameSettings);
        var live = new LiveGame { Id = Guid.NewGuid(), Game = game, SolverSeed = seed };
        live.Users[0] = userId;

        if (gameSettings.ResolvedOpponent is OpponentSettings.Computer computer)
        {
            live.Users[1] = "computer";
            var rules = Ruleset.Parse(gameSettings.Ruleset);
            var secret = rules.AllCodes[new Random(seed).Next(rules.CodeCount)];
            var set = game.SetSecret(1, secret);
            if (!set.Ok)
                throw new HubException(set.ErrorCode + ":" + set.ErrorMessage);
            live.Solver = new PolicySolver(computer.Agent, computer.Per, environment.ContentRootPath);
            live.Solver.Reset(rules, seed);
        }

        liveGames.Add(live);
        await repository.SaveAsync(live);
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(live.Id));
        var snapshot = Snapshot(live);
        await Clients.Group(Group(live.Id)).GameState(snapshot);
        return snapshot;
    }

    public async Task<GameSnapshot> JoinQueue()
    {
        var userId = RequireUser();
        if (!queue.TryPair(userId, out var partner))
        {
            queue.Enqueue(userId);
            await Clients.Caller.QueueJoined(1);
            throw new HubException("QUEUED:Waiting for an opponent.");
        }

        var settings = new GameSettings();
        var live = new LiveGame { Id = Guid.NewGuid(), Game = new Game(settings), SolverSeed = Random.Shared.Next() };
        live.Users[0] = partner;
        live.Users[1] = userId;
        liveGames.Add(live);
        await repository.SaveAsync(live);
        await Groups.AddToGroupAsync(Context.ConnectionId, Group(live.Id));
        var snapshot = Snapshot(live);
        await Clients.User(partner).GameState(snapshot);
        await Clients.Caller.GameState(snapshot);
        return snapshot;
    }

    public async Task InviteFriend(string friendUserId)
    {
        var userId = RequireUser();
        if (friendUserId == userId)
            throw new HubException("INVALID_INVITE:You cannot invite yourself.");

        var live = new LiveGame
        {
            Id = Guid.NewGuid(),
            Game = new Game(new GameSettings()),
            SolverSeed = Random.Shared.Next()
        };
        live.Users[0] = userId;
        liveGames.Add(live);
        await repository.SaveAsync(live);
        var inviteId = liveGames.CreateInvite(live.Id, userId, friendUserId);
        await Clients.User(friendUserId).Invite(inviteId, userId);
    }

    public async Task<GameSnapshot> RespondInvite(string inviteId, bool accept)
    {
        var userId = RequireUser();
        if (!liveGames.TakeInvite(inviteId, userId, out var fromUserId, out var gameId))
            throw new HubException("INVALID_INVITE:That invitation is not open.");

        var live = liveGames.Find(gameId) ?? throw new HubException("INVALID_INVITE:The game no longer exists.");
        if (!accept)
        {
            await Clients.User(fromUserId).Error("INVITE_DECLINED", "The invitation was declined.");
            throw new HubException("INVITE_DECLINED:You declined the invitation.");
        }

        await live.Gate.WaitAsync();
        try
        {
            live.Users[1] = userId;
            await repository.SaveAsync(live);
        }
        finally
        {
            live.Gate.Release();
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, Group(live.Id));
        var snapshot = Snapshot(live);
        await Clients.Group(Group(live.Id)).GameState(snapshot);
        await Clients.User(fromUserId).GameState(snapshot);
        return snapshot;
    }

    public Task<GameSnapshot> SetSecret(string code) => Mutate(live =>
    {
        var seat = Seat(live);
        var result = live.Game.SetSecret(seat, code);
        if (!result.Ok)
            throw new HubException(result.ErrorCode + ":" + result.ErrorMessage);
        ArmTimer(live);
    });

    public Task<GameSnapshot> SubmitGuess(string guess) => Mutate(live =>
    {
        EnsureDeadline(live);
        var seat = Seat(live);
        var result = live.Game.SubmitGuess(seat, guess);
        if (!result.Ok)
            throw new HubException(result.ErrorCode + ":" + result.ErrorMessage);
        ComputerDirector.Play(live);
        ArmTimer(live);
    });

    public Task<GameSnapshot> ChangeSecret(int[] positions, string newDigits) => Mutate(live =>
    {
        EnsureDeadline(live);
        var seat = Seat(live);
        var digits = newDigits.ToCharArray();
        var result = live.Game.ChangeSecret(seat, positions, digits);
        if (!result.Ok)
            throw new HubException(result.ErrorCode + ":" + result.ErrorMessage);
        if (seat == 0)
            ComputerDirector.NoteHumanChange(live, result.Value!.Turn);
        ComputerDirector.Play(live);
        ArmTimer(live);
    });

    public async Task SendChat(string text)
    {
        var userId = RequireUser();
        var live = RequireGame();
        if (string.IsNullOrWhiteSpace(text) || text.Length > 500)
            throw new HubException("INVALID_CHAT:Enter a shorter message.");
        await Clients.Group(Group(live.Id)).Chat(userId, text, DateTimeOffset.UtcNow);
    }

    public Task<GameSnapshot> Resign() => Mutate(live =>
    {
        var result = live.Game.Resign(Seat(live));
        if (!result.Ok)
            throw new HubException(result.ErrorCode + ":" + result.ErrorMessage);
    });

    private async Task<GameSnapshot> Mutate(Action<LiveGame> action)
    {
        var live = RequireGame();
        await live.Gate.WaitAsync();
        GameSnapshot snapshot;
        var announced = live.Game.Notifications.Count;
        try
        {
            action(live);
            await repository.SaveAsync(live);
            snapshot = Snapshot(live);
        }
        finally
        {
            live.Gate.Release();
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, Group(live.Id));
        await Clients.Group(Group(live.Id)).GameState(snapshot);
        if (live.Game.Settings.NotifyOnChange && live.Game.Notifications.Count > announced)
        {
            var turn = live.Game.Notifications[^1].Turn;
            await Clients.Group(Group(live.Id)).OpponentChangedSecret(turn);
        }

        return snapshot;
    }

    private static void ArmTimer(LiveGame live)
    {
        if (live.Game.Phase is GamePhase.InProgress or GamePhase.FinalTurn)
            live.Game.ArmTurnTimer(DateTimeOffset.UtcNow);
    }

    private static void EnsureDeadline(LiveGame live)
    {
        if (live.Game.TurnDeadlineUtc is DateTimeOffset deadline && DateTimeOffset.UtcNow > deadline)
            throw new HubException("TURN_EXPIRED:The turn timer has run out.");
    }

    private LiveGame RequireGame()
    {
        var userId = RequireUser();
        return liveGames.ActiveFor(userId) ?? throw new HubException("NO_GAME:Create or join a game first.");
    }

    private int Seat(LiveGame live)
    {
        var userId = RequireUser();
        if (live.Users[0] == userId)
            return 0;
        if (live.Users[1] == userId)
            return 1;
        throw new HubException("NOT_A_PLAYER:You are not seated in this game.");
    }

    private string RequireUser() => Context.UserIdentifier ?? throw new HubException("UNAUTHENTICATED:Sign in again.");

    private static string Group(Guid id) => "g:" + id.ToString("N");

    private static GameSnapshot Snapshot(LiveGame live) => new(live.Id, live.Game.ToPublicView());
}
