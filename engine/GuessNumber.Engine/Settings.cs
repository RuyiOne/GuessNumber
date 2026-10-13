using System.Text.Json.Serialization;

namespace GuessNumber.Engine;

public static class NumberChangeModes
{
    public const string Once = "once";
    public const string Unlimited = "unlimited";
    public const string Disabled = "disabled";
}

public static class AgentNames
{
    public const string Swor = "swor";
    public const string Dqn = "dqn";
    public const string Double = "double";
    public const string Duelling = "duelling";
    public const string DoubleDuelling = "doubleDuelling";

    public static readonly string[] All = [Swor, Dqn, Double, Duelling, DoubleDuelling];
}

public static class ChangePolicies
{
    public const string Never = "never";
    public const string Heuristic = "heuristic";
}

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(Human), "human")]
[JsonDerivedType(typeof(Computer), "computer")]
public abstract record OpponentSettings
{
    public sealed record Human : OpponentSettings;

    public sealed record Computer(
        string Agent,
        bool Per = false,
        bool AllowComputerChange = true,
        string ChangePolicy = ChangePolicies.Never) : OpponentSettings;
}

/// <summary>
/// Fixed when a game is created. Field names and defaults follow spec §4.
/// </summary>
public sealed record GameSettings(
    string Ruleset = "classic4",
    string NumberChange = NumberChangeModes.Once,
    int ChangeCost = 25,
    int ChangeDigits = 2,
    bool NotifyOnChange = true,
    bool ChangeConsumesTurn = true,
    int TurnTimerSec = 60,
    bool EqualTurns = false,
    OpponentSettings? Opponent = null)
{
    public OpponentSettings ResolvedOpponent => Opponent ?? new OpponentSettings.Human();

    public void Validate()
    {
        _ = GuessNumber.Engine.Ruleset.Parse(Ruleset);

        if (NumberChange is not (NumberChangeModes.Once or NumberChangeModes.Unlimited or NumberChangeModes.Disabled))
            throw new ArgumentException("numberChange must be once, unlimited or disabled.", nameof(NumberChange));

        // Cost and width are fixed by the ruleset and are not editable in casual play.
        if (ChangeCost != 25)
            throw new ArgumentException("changeCost is fixed at 25.", nameof(ChangeCost));
        if (ChangeDigits != 2)
            throw new ArgumentException("changeDigits is fixed at 2.", nameof(ChangeDigits));

        if (TurnTimerSec is not (0 or 30 or 60))
            throw new ArgumentException("turnTimerSec must be 60, 30 or 0.", nameof(TurnTimerSec));

        if (ResolvedOpponent is OpponentSettings.Computer computer)
        {
            if (!AgentNames.All.Contains(computer.Agent))
                throw new ArgumentException($"Unknown agent '{computer.Agent}'.", nameof(Opponent));
            if (computer.ChangePolicy is not (ChangePolicies.Never or ChangePolicies.Heuristic))
                throw new ArgumentException("changePolicy must be never or heuristic.", nameof(Opponent));
            // TODO spec §10.1: per is ignored for swor. Stored so replays stay reproducible.
        }
    }
}

public sealed record PlayerSettings(
    string DisplayName,
    string Locale = "en-GB",
    string Theme = "light",
    string DefaultSolver = AgentNames.Swor,
    bool Notifications = true);
