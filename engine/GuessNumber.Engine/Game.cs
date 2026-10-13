namespace GuessNumber.Engine;

public static class GameErrorCodes
{
    public const string InsufficientScore = "INSUFFICIENT_SCORE";
    public const string ChangeLimitReached = "CHANGE_LIMIT_REACHED";
    public const string InvalidCode = "INVALID_CODE";
    public const string InvalidChangeCount = "INVALID_CHANGE_COUNT";
    public const string GameOver = "GAME_OVER";
    public const string ChangeDisabledFinalTurn = "CHANGE_DISABLED_FINAL_TURN";
    public const string ChangeDisabled = "CHANGE_DISABLED";
    public const string NotYourTurn = "NOT_YOUR_TURN";
    public const string InvalidGuess = "INVALID_GUESS";
    public const string WrongPhase = "WRONG_PHASE";
    public const string UnknownPlayer = "UNKNOWN_PLAYER";
}

public enum GamePhase
{
    AwaitingSecrets,
    InProgress,
    FinalTurn,
    Finished
}

public enum MoveKind
{
    Guess,
    Change,
    Resign
}

public sealed record MoveRecord(
    int Turn,
    int Player,
    MoveKind Kind,
    string? Guess,
    int? Dead,
    int? Wounded,
    int PointsDelta,
    bool RevisitedPreviousSecret);

public sealed record OpponentChangedSecret(int Turn);

public readonly record struct RuleResult<T>(T? Value, string? ErrorCode, string? ErrorMessage)
{
    public bool Ok => ErrorCode is null;

    public static RuleResult<T> Success(T value) => new(value, null, null);

    public static RuleResult<T> Fail(string code, string message) => new(default, code, message);
}

/// <summary>
/// Two-player game. Player 0 is the inviter, or the human when the opponent is the computer, and moves first.
/// Commands are applied one at a time; a change and a guess cannot both land on the same turn (E9).
/// </summary>
public sealed class Game
{
    private readonly List<string>[] _secretHistory = [[], []];

    public Game(GameSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        settings.Validate();
        Settings = settings;
        Rules = Ruleset.Parse(settings.Ruleset);
    }

    public GameSettings Settings { get; }
    public Ruleset Rules { get; }
    public string?[] Secrets { get; } = new string?[2];
    public int[] Scores { get; } = new int[2];
    public int[] ChangesUsed { get; } = new int[2];
    public List<MoveRecord> Moves { get; } = [];
    public List<OpponentChangedSecret> Notifications { get; } = [];
    public GamePhase Phase { get; private set; } = GamePhase.AwaitingSecrets;
    public int CurrentPlayer { get; private set; }
    public int Turn { get; private set; } = 1;
    public int? Winner { get; private set; }
    public int? FirstSolver { get; private set; }
    public DateTimeOffset? TurnDeadlineUtc { get; private set; }

    public IReadOnlyList<string> SecretHistory(int player) => _secretHistory[CheckPlayer(player)];

    public void ArmTurnTimer(DateTimeOffset nowUtc)
    {
        if (Settings.TurnTimerSec <= 0)
        {
            TurnDeadlineUtc = null;
            return;
        }

        TurnDeadlineUtc = nowUtc.AddSeconds(Settings.TurnTimerSec);
    }

    public RuleResult<bool> SetSecret(int player, string code)
    {
        CheckPlayer(player);
        if (Phase != GamePhase.AwaitingSecrets)
            return Fail<bool>(GameErrorCodes.WrongPhase, "Secrets are already set.");
        if (Validator.RejectReason(code, Rules) is string secretReason)
            return Fail<bool>(GameErrorCodes.InvalidCode, secretReason);

        Secrets[player] = code;
        _secretHistory[player].Add(code);
        if (Secrets[0] is not null && Secrets[1] is not null)
        {
            Phase = GamePhase.InProgress;
            CurrentPlayer = 0;
            Turn = 1;
        }

        return RuleResult<bool>.Success(true);
    }

    public RuleResult<MoveRecord> SubmitGuess(int player, string guess)
    {
        var gate = GateAction(player);
        if (!gate.Ok)
            return Fail<MoveRecord>(gate.ErrorCode!, gate.ErrorMessage!);
        if (Validator.RejectReason(guess, Rules) is string guessReason)
            return Fail<MoveRecord>(GameErrorCodes.InvalidGuess, guessReason);

        var opponent = 1 - player;
        var score = Scorer.Score(guess, Secrets[opponent]!);
        Scores[player] += score.Points;
        var move = new MoveRecord(Turn, player, MoveKind.Guess, guess, score.Dead, score.Wounded, score.Points, false);
        Moves.Add(move);

        var solved = score.IsFullMatch(Rules.Length);
        if (solved && FirstSolver is null)
            FirstSolver = player;

        if (Phase == GamePhase.FinalTurn)
        {
            // TODO spec §10.5: equal-turns is off by default. The second player has had the extra turn.
            Phase = GamePhase.Finished;
            Winner = FirstSolver;
            return RuleResult<MoveRecord>.Success(move);
        }

        if (solved)
        {
            // TODO spec §3.1 words the win as "four dead". That is a full match for classic4.
            // Longer codes (classic5) are won by matching every position.
            if (Settings.EqualTurns && player == 0)
            {
                Phase = GamePhase.FinalTurn;
                AdvanceTurn();
            }
            else
            {
                Phase = GamePhase.Finished;
                Winner = player;
            }
        }
        else
        {
            AdvanceTurn();
        }

        return RuleResult<MoveRecord>.Success(move);
    }

    public RuleResult<MoveRecord> ChangeSecret(int player, IReadOnlyList<int> positions, IReadOnlyList<char> newDigits)
    {
        ArgumentNullException.ThrowIfNull(positions);
        ArgumentNullException.ThrowIfNull(newDigits);

        CheckPlayer(player);
        if (Phase == GamePhase.Finished)
            return Fail<MoveRecord>(GameErrorCodes.GameOver, "The game has already ended.");
        if (Phase == GamePhase.AwaitingSecrets)
            return Fail<MoveRecord>(GameErrorCodes.WrongPhase, "Both secrets must be set before a change.");
        if (player != CurrentPlayer)
            return Fail<MoveRecord>(GameErrorCodes.NotYourTurn, "It is not this player's turn.");
        if (Phase == GamePhase.FinalTurn)
            return Fail<MoveRecord>(GameErrorCodes.ChangeDisabledFinalTurn, "Number changes are disabled on the final turn.");
        if (Settings.NumberChange == NumberChangeModes.Disabled)
            return Fail<MoveRecord>(GameErrorCodes.ChangeDisabled, "Number changes are disabled for this game.");
        if (Settings.NumberChange == NumberChangeModes.Once && ChangesUsed[player] >= 1)
            return Fail<MoveRecord>(GameErrorCodes.ChangeLimitReached, "The number-change allowance for this game has been used.");
        if (Scores[player] < Settings.ChangeCost)
            return Fail<MoveRecord>(GameErrorCodes.InsufficientScore, "The score is below 25, so the number cannot be changed.");

        if (positions.Count != Settings.ChangeDigits || newDigits.Count != Settings.ChangeDigits || positions.Distinct().Count() != Settings.ChangeDigits)
            return Fail<MoveRecord>(GameErrorCodes.InvalidChangeCount, "A number change must select exactly two positions.");

        var current = Secrets[player]!;
        var chars = current.ToCharArray();
        for (var i = 0; i < positions.Count; i++)
        {
            var position = positions[i];
            if (position < 0 || position >= Rules.Length)
                return Fail<MoveRecord>(GameErrorCodes.InvalidChangeCount, "A selected position is outside the code.");
            var digit = newDigits[i];
            if (digit < '0' || digit > '9')
                return Fail<MoveRecord>(GameErrorCodes.InvalidCode, "A replacement must be a digit.");
            chars[position] = digit;
        }

        var updated = new string(chars);
        var differences = 0;
        for (var i = 0; i < updated.Length; i++)
        {
            if (updated[i] != current[i])
                differences++;
        }

        // A swap of the two positions counts as two changed positions.
        if (differences != Settings.ChangeDigits)
            return Fail<MoveRecord>(GameErrorCodes.InvalidChangeCount, "The new code must differ in exactly two positions.");

        // TODO spec E3 says a classic code that "contains 0" is invalid. 0 is rejected here because it
        // is outside the classic pool. pool0to9 allows 0. Repeats are rejected unless the ruleset allows them.
        if (Validator.RejectReason(updated, Rules) is string codeReason)
            return Fail<MoveRecord>(GameErrorCodes.InvalidCode, codeReason);

        var revisited = _secretHistory[player].Contains(updated);
        Secrets[player] = updated;
        _secretHistory[player].Add(updated);
        Scores[player] = Math.Max(0, Scores[player] - Settings.ChangeCost);
        ChangesUsed[player]++;

        var move = new MoveRecord(Turn, player, MoveKind.Change, null, null, null, -Settings.ChangeCost, revisited);
        Moves.Add(move);

        if (Settings.NotifyOnChange)
            Notifications.Add(new OpponentChangedSecret(Turn));

        // TODO spec §10.4: a change consumes the turn. Configurable; default true.
        if (Settings.ChangeConsumesTurn)
            AdvanceTurn();

        return RuleResult<MoveRecord>.Success(move);
    }

    public RuleResult<MoveRecord> Resign(int player)
    {
        CheckPlayer(player);
        if (Phase is GamePhase.Finished or GamePhase.AwaitingSecrets)
            return Fail<MoveRecord>(GameErrorCodes.WrongPhase, "This game cannot be resigned now.");

        var move = new MoveRecord(Turn, player, MoveKind.Resign, null, null, null, 0, false);
        Moves.Add(move);
        Phase = GamePhase.Finished;
        Winner = 1 - player;
        return RuleResult<MoveRecord>.Success(move);
    }

    public PublicGameView ToPublicView()
    {
        var moves = new List<PublicMove>(Moves.Count);
        foreach (var move in Moves)
        {
            moves.Add(new PublicMove(
                move.Turn,
                move.Player,
                move.Kind.ToString().ToLowerInvariant(),
                move.Guess,
                move.Dead,
                move.Wounded,
                move.PointsDelta,
                move.RevisitedPreviousSecret));
        }

        return new PublicGameView(
            Phase.ToString(),
            Turn,
            CurrentPlayer,
            Winner,
            [Scores[0], Scores[1]],
            moves,
            Notifications.Select(n => n.Turn).ToArray());
    }

    private void AdvanceTurn()
    {
        CurrentPlayer = 1 - CurrentPlayer;
        Turn++;
        TurnDeadlineUtc = null;
    }

    private RuleResult<bool> GateAction(int player)
    {
        CheckPlayer(player);
        if (Phase == GamePhase.Finished)
            return Fail<bool>(GameErrorCodes.GameOver, "The game has already ended.");
        if (Phase == GamePhase.AwaitingSecrets)
            return Fail<bool>(GameErrorCodes.WrongPhase, "Both secrets must be set before a guess.");
        if (player != CurrentPlayer)
            return Fail<bool>(GameErrorCodes.NotYourTurn, "It is not this player's turn.");
        return RuleResult<bool>.Success(true);
    }

    private static int CheckPlayer(int player)
    {
        if (player is not (0 or 1))
            throw new ArgumentOutOfRangeException(nameof(player), "Player must be 0 or 1.");
        return player;
    }

    private static RuleResult<T> Fail<T>(string code, string message) => RuleResult<T>.Fail(code, message);
}

public sealed record PublicMove(
    int Turn,
    int Player,
    string Kind,
    string? Guess,
    int? Dead,
    int? Wounded,
    int PointsDelta,
    bool RevisitedPreviousSecret);

/// <summary>
/// Client payload. Secrets and secret history are omitted.
/// Change rows carry a −25 delta and no digits. <see cref="AnnouncedChangeTurns"/> is empty when notifyOnChange is false.
/// </summary>
public sealed record PublicGameView(
    string Phase,
    int Turn,
    int CurrentPlayer,
    int? Winner,
    int[] Scores,
    IReadOnlyList<PublicMove> Moves,
    IReadOnlyList<int> AnnouncedChangeTurns);
