namespace GuessNumber.Engine;

public readonly record struct Score(int Dead, int Wounded)
{
    public int Points => Dead * 10 + Wounded * 2;

    public bool IsFullMatch(int length) => Dead == length;
}

public static class Scorer
{
    /// <summary>
    /// dead = |{i : g_i = s_i}|, wounded = |set(g) ∩ set(s)| − dead.
    /// The two legacy scorers agree on codes with distinct digits.
    /// </summary>
    public static Score Score(string guess, string secret)
    {
        ArgumentNullException.ThrowIfNull(guess);
        ArgumentNullException.ThrowIfNull(secret);
        if (guess.Length != secret.Length)
            throw new ArgumentException("Guess and secret must be the same length.");

        var dead = 0;
        for (var i = 0; i < guess.Length; i++)
        {
            if (guess[i] == secret[i])
                dead++;
        }

        Span<int> guessDigits = stackalloc int[10];
        Span<int> secretDigits = stackalloc int[10];
        for (var i = 0; i < guess.Length; i++)
        {
            var g = guess[i] - '0';
            var s = secret[i] - '0';
            if ((uint)g > 9 || (uint)s > 9)
                throw new ArgumentException("Codes must be digits.");
            guessDigits[g] = 1;
            secretDigits[s] = 1;
        }

        var intersection = 0;
        for (var digit = 0; digit < 10; digit++)
        {
            if (guessDigits[digit] == 1 && secretDigits[digit] == 1)
                intersection++;
        }

        var wounded = intersection - dead;
        // TODO repeatsAllowed: the set formula can go negative when one digit is dead more than once.
        // Distinct-digit rulesets never hit this. Clamped so the displayed score stays defined.
        if (wounded < 0)
            wounded = 0;

        return new Score(dead, wounded);
    }
}

public static class Validator
{
    public static bool IsValid(string? code, Ruleset ruleset) => RejectReason(code, ruleset) is null;

    /// <summary>
    /// A player-facing reason the code is outside the ruleset, or null when it is legal.
    /// </summary>
    public static string? RejectReason(string? code, Ruleset ruleset)
    {
        ArgumentNullException.ThrowIfNull(ruleset);
        if (string.IsNullOrEmpty(code) || code.Length != ruleset.Length)
            return $"A code must be {ruleset.Length} digits.";

        Span<bool> seen = stackalloc bool[10];
        foreach (var symbol in code)
        {
            if (symbol < '0' || symbol > '9')
                return "Use digits only.";
            var digit = symbol - '0';
            if (digit < ruleset.MinDigit || digit > ruleset.MaxDigit)
            {
                return digit == 0
                    ? "0 is not allowed. Use digits from 1 to 9."
                    : $"Digits must be from {ruleset.MinDigit} to {ruleset.MaxDigit}.";
            }

            if (!ruleset.AllowRepeats && seen[digit])
                return "That number repeats a digit. Each digit must be different.";
            seen[digit] = true;
        }

        return null;
    }
}
