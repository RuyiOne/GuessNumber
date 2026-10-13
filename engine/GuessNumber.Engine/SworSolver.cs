namespace GuessNumber.Engine;

public readonly record struct SolverStats(int Guesses, int CandidateCount, int ChangesObserved, int Recoveries);

public interface ISolver
{
    void Reset(Ruleset ruleset, int seed);
    string NextGuess();
    void Observe(string guess, int dead, int wounded);
    void OnOpponentChange(int? turn);
    SolverStats Stats();
}

/// <summary>
/// Sampling without replacement. Port of getUniqueNumbers / makeAIGuess / filterAIPossibleNumbers.
/// </summary>
public sealed class SworSolver : ISolver
{
    private readonly record struct Observation(string Guess, int Dead, int Wounded, int Turn);

    private Ruleset _ruleset = Ruleset.Classic4;
    private Random _random = new(0);
    private List<string> _all = [];
    private List<string> _candidates = [];
    private readonly HashSet<string> _guessed = [];
    private readonly List<Observation> _history = [];
    private int _turnClock = 1;
    private int _guessCount;
    private int _changes;
    private int _recoveries;

    public IReadOnlyList<string> Candidates => _candidates;

    public void Reset(Ruleset ruleset, int seed)
    {
        ArgumentNullException.ThrowIfNull(ruleset);
        _ruleset = ruleset;
        _random = new Random(seed);
        _all = ruleset.AllCodes.ToList();
        _candidates = _all.ToList();
        _guessed.Clear();
        _history.Clear();
        _turnClock = 1;
        _guessCount = 0;
        _changes = 0;
        _recoveries = 0;
    }

    public string NextGuess()
    {
        var pool = new List<string>();
        foreach (var code in _candidates)
        {
            if (!_guessed.Contains(code))
                pool.Add(code);
        }

        if (pool.Count == 0)
        {
            // TODO The spec samples Uniform(C \ guessed) and does not say what happens when that set is empty.
            _guessed.Clear();
            pool.AddRange(_candidates);
        }

        if (pool.Count == 0)
            throw new InvalidOperationException("No legal guesses remain.");

        var guess = pool[_random.Next(pool.Count)];
        _guessed.Add(guess);
        _guessCount++;
        return guess;
    }

    /// <summary>
    /// Tags the next <see cref="Observe"/> with a game turn so an announced change can split the history.
    /// Solo play leaves the clock to increment on its own.
    /// </summary>
    public void StampTurn(int turn) => _turnClock = turn;

    public void Observe(string guess, int dead, int wounded)
    {
        ArgumentException.ThrowIfNullOrEmpty(guess);
        _history.Add(new Observation(guess, dead, wounded, _turnClock));
        _turnClock++;

        var next = new List<string>();
        foreach (var code in _candidates)
        {
            var score = Scorer.Score(guess, code);
            if (score.Dead == dead && score.Wounded == wounded)
                next.Add(code);
        }

        _candidates = next;
        if (_candidates.Count == 0)
        {
            DetectUnannounced();
            _recoveries++;
        }
    }

    public void OnOpponentChange(int? turn)
    {
        _changes++;
        if (turn is int announced)
        {
            _candidates = Expand(announced);
            _guessed.Clear();
            return;
        }

        DetectUnannounced();
        _recoveries++;
    }

    public SolverStats Stats() => new(_guessCount, _candidates.Count, _changes, _recoveries);

    private void DetectUnannounced()
    {
        var turns = new List<int>();
        foreach (var observation in _history)
        {
            if (!turns.Contains(observation.Turn))
                turns.Add(observation.Turn);
        }

        turns.Sort();
        turns.Reverse();
        foreach (var turn in turns)
        {
            var trial = Expand(turn);
            if (trial.Count > 0)
            {
                _candidates = trial;
                _guessed.Clear();
                return;
            }
        }

        var last = _history.Count <= 2 ? _history : _history.GetRange(_history.Count - 2, 2);
        _candidates = [];
        foreach (var code in _all)
        {
            if (Matches(code, last))
                _candidates.Add(code);
        }

        _guessed.Clear();
    }

    private List<string> Expand(int turn)
    {
        var pre = new List<string>();
        foreach (var code in _all)
        {
            if (ConsistentBefore(code, turn))
                pre.Add(code);
        }

        var expanded = new HashSet<string>();
        foreach (var code in pre)
        {
            foreach (var neighbour in NeighboursAtDistanceTwo(code))
                expanded.Add(neighbour);
        }

        var result = new List<string>();
        foreach (var code in expanded)
        {
            if (ConsistentFrom(code, turn))
                result.Add(code);
        }

        return result;
    }

    private bool ConsistentBefore(string code, int turn)
    {
        foreach (var observation in _history)
        {
            if (observation.Turn >= turn)
                continue;
            var score = Scorer.Score(observation.Guess, code);
            if (score.Dead != observation.Dead || score.Wounded != observation.Wounded)
                return false;
        }

        return true;
    }

    private bool ConsistentFrom(string code, int turn)
    {
        foreach (var observation in _history)
        {
            if (observation.Turn < turn)
                continue;
            var score = Scorer.Score(observation.Guess, code);
            if (score.Dead != observation.Dead || score.Wounded != observation.Wounded)
                return false;
        }

        return true;
    }

    private static bool Matches(string code, List<Observation> history)
    {
        foreach (var observation in history)
        {
            var score = Scorer.Score(observation.Guess, code);
            if (score.Dead != observation.Dead || score.Wounded != observation.Wounded)
                return false;
        }

        return true;
    }

    /// <summary>N2(c): valid codes that differ from <paramref name="code"/> in exactly two positions.</summary>
    private IEnumerable<string> NeighboursAtDistanceTwo(string code)
    {
        var length = code.Length;
        var chars = code.ToCharArray();
        for (var i = 0; i < length; i++)
        {
            for (var j = i + 1; j < length; j++)
            {
                var retained = 0;
                for (var k = 0; k < length; k++)
                {
                    if (k == i || k == j)
                        continue;
                    retained |= 1 << (code[k] - '0');
                }

                for (var d1 = _ruleset.MinDigit; d1 <= _ruleset.MaxDigit; d1++)
                {
                    if (d1 == code[i] - '0')
                        continue;
                    if (!_ruleset.AllowRepeats && (retained & (1 << d1)) != 0)
                        continue;

                    chars[i] = (char)('0' + d1);
                    var used = retained;
                    if (!_ruleset.AllowRepeats)
                        used |= 1 << d1;

                    for (var d2 = _ruleset.MinDigit; d2 <= _ruleset.MaxDigit; d2++)
                    {
                        if (d2 == code[j] - '0')
                            continue;
                        if (!_ruleset.AllowRepeats && (used & (1 << d2)) != 0)
                            continue;

                        chars[j] = (char)('0' + d2);
                        yield return new string(chars);
                    }
                }

                chars[i] = code[i];
                chars[j] = code[j];
            }
        }
    }
}
