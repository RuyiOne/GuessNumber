namespace GuessNumber.Engine;

/// <summary>
/// A code space. Generation is lexicographic: the left-most digit varies slowest,
/// and each digit runs from <see cref="MinDigit"/> to <see cref="MaxDigit"/>.
/// </summary>
public sealed class Ruleset
{
    private readonly Lazy<string[]> _codes;

    private Ruleset(string name, int length, int minDigit, int maxDigit, bool allowRepeats)
    {
        Name = name;
        Length = length;
        MinDigit = minDigit;
        MaxDigit = maxDigit;
        AllowRepeats = allowRepeats;
        _codes = new Lazy<string[]>(Generate);
    }

    public string Name { get; }
    public int Length { get; }
    public int MinDigit { get; }
    public int MaxDigit { get; }
    public bool AllowRepeats { get; }
    public IReadOnlyList<string> AllCodes => _codes.Value;
    public int CodeCount => AllCodes.Count;

    public static Ruleset Classic4 { get; } = new("classic4", 4, 1, 9, false);
    public static Ruleset Classic5 { get; } = new("classic5", 5, 1, 9, false);
    public static Ruleset Pool0to9 { get; } = new("pool0to9", 4, 0, 9, false);

    // TODO spec §4 lists "repeatsAllowed" without a length or digit pool.
    // Default used here: 4 digits from 1 to 9, repeats permitted (9^4 = 6,561).
    public static Ruleset RepeatsAllowed { get; } = new("repeatsAllowed", 4, 1, 9, true);

    public static Ruleset Parse(string name) => name switch
    {
        "classic4" => Classic4,
        "classic5" => Classic5,
        "pool0to9" => Pool0to9,
        "repeatsAllowed" => RepeatsAllowed,
        _ => throw new ArgumentException($"Unknown ruleset '{name}'.", nameof(name))
    };

    public bool IsListed(string code)
    {
        if (!Validator.IsValid(code, this))
            return false;
        return true;
    }

    private string[] Generate()
    {
        var list = new List<string>();
        var buffer = new char[Length];

        void Walk(int position, int usedMask)
        {
            if (position == Length)
            {
                list.Add(new string(buffer));
                return;
            }

            for (var digit = MinDigit; digit <= MaxDigit; digit++)
            {
                var bit = 1 << digit;
                if (!AllowRepeats && (usedMask & bit) != 0)
                    continue;
                buffer[position] = (char)('0' + digit);
                Walk(position + 1, usedMask | bit);
            }
        }

        Walk(0, 0);
        return list.ToArray();
    }
}
