using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GuessNumber.Engine.Tests;

public class ScoringTests
{
    [Fact]
    public void Classic_spaces_have_the_specified_sizes()
    {
        Assert.Equal(3024, Ruleset.Classic4.CodeCount);
        Assert.Equal(15120, Ruleset.Classic5.CodeCount);
        Assert.Equal(5040, Ruleset.Pool0to9.CodeCount);
        Assert.Equal(6561, Ruleset.RepeatsAllowed.CodeCount);
        Assert.Equal("1234", Ruleset.Classic4.AllCodes[0]);
        Assert.Equal("9876", Ruleset.Classic4.AllCodes[^1]);
        Assert.Equal("12345", Ruleset.Classic5.AllCodes[0]);
        Assert.Equal("0123", Ruleset.Pool0to9.AllCodes[0]);
    }

    [Theory]
    [InlineData("1234", "1234", 4, 0, 40)]
    [InlineData("1234", "1235", 3, 0, 30)]
    [InlineData("1234", "1243", 2, 2, 24)]
    [InlineData("1234", "1245", 2, 1, 22)]
    [InlineData("1234", "5678", 0, 0, 0)]
    [InlineData("1234", "5671", 0, 1, 2)]
    [InlineData("1234", "4321", 0, 4, 8)]
    public void Known_scores(string guess, string secret, int dead, int wounded, int points)
    {
        var score = Scorer.Score(guess, secret);
        Assert.Equal(dead, score.Dead);
        Assert.Equal(wounded, score.Wounded);
        Assert.Equal(points, score.Points);
    }

    [Fact]
    public void Properties_hold_for_random_classic4_pairs()
    {
        var codes = Ruleset.Classic4.AllCodes;
        var random = new Random(20261013);
        for (var i = 0; i < 3000; i++)
        {
            var guess = codes[random.Next(codes.Count)];
            var secret = codes[random.Next(codes.Count)];
            var score = Scorer.Score(guess, secret);
            var mirrored = Scorer.Score(secret, guess);
            var legacy = LegacyDistinctScore(guess, secret);

            Assert.InRange(score.Dead, 0, 4);
            Assert.InRange(score.Wounded, 0, 4);
            Assert.Equal(score.Dead * 10 + score.Wounded * 2, score.Points);
            Assert.Equal(guess == secret, score.Dead == 4);
            Assert.Equal(score, mirrored);
            Assert.Equal(legacy.Dead, score.Dead);
            Assert.Equal(legacy.Wounded, score.Wounded);
            Assert.True(score.Dead + score.Wounded <= 4);
        }
    }

    [Fact]
    public void Solving_guess_scores_forty_points_and_not_a_bonus()
    {
        var score = Scorer.Score("2468", "2468");
        Assert.Equal(40, score.Points);
        Assert.Equal(4 * 10, score.Points);
    }

    [Fact]
    public void Parity_vector_is_exported_from_the_engine()
    {
        var vector = new ParityVector();
        foreach (var ruleset in new[] { Ruleset.Classic4, Ruleset.Classic5, Ruleset.Pool0to9, Ruleset.RepeatsAllowed })
        {
            vector.Rulesets[ruleset.Name] = new RulesetVector
            {
                Count = ruleset.CodeCount,
                First = ruleset.AllCodes[0],
                Last = ruleset.AllCodes[^1],
                Sha256 = Sha256(string.Join("\n", ruleset.AllCodes))
            };
        }

        foreach (var (guess, secret) in new (string, string)[]
        {
            ("1234", "1234"), ("1234", "1235"), ("1234", "1243"), ("1234", "1245"),
            ("1234", "5678"), ("1234", "5671"), ("1234", "4321"), ("5687", "5678")
        })
        {
            var score = Scorer.Score(guess, secret);
            vector.Scores.Add(new ScoreVector
            {
                Guess = guess, Secret = secret, Dead = score.Dead, Wounded = score.Wounded, Points = score.Points
            });
        }

        var secretCode = "9876";
        var remaining = Ruleset.Classic4.AllCodes.ToList();
        foreach (var guess in new[] { "1234", "5678", "2468" })
        {
            var feedback = Scorer.Score(guess, secretCode);
            vector.Filter.Steps.Add(new ScoreVector
            {
                Guess = guess, Secret = secretCode, Dead = feedback.Dead, Wounded = feedback.Wounded, Points = feedback.Points
            });
            remaining = remaining.Where(code =>
            {
                var score = Scorer.Score(guess, code);
                return score.Dead == feedback.Dead && score.Wounded == feedback.Wounded;
            }).ToList();
        }

        vector.Filter.Secret = secretCode;
        vector.Filter.RemainingCount = remaining.Count;
        vector.Filter.RemainingSha256 = Sha256(string.Join("\n", remaining));
        Assert.Equal(120, Ruleset.Classic4.AllCodes.Count(code =>
        {
            var score = Scorer.Score("1234", code);
            return score.Dead == 0 && score.Wounded == 0;
        }));

        var path = Path.Combine(RepoRoot(), "tests", "vectors", "parity.json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(vector, JsonOptions()) + Environment.NewLine);
        Assert.True(remaining.Count > 0);
    }

    private static Score LegacyDistinctScore(string guess, string secret)
    {
        var dead = 0;
        var matchedSecret = new bool[4];
        var matchedGuess = new bool[4];
        for (var i = 0; i < 4; i++)
        {
            if (guess[i] == secret[i])
            {
                dead++;
                matchedSecret[i] = true;
                matchedGuess[i] = true;
            }
        }

        var wounded = 0;
        for (var i = 0; i < 4; i++)
        {
            if (matchedGuess[i])
                continue;
            for (var j = 0; j < 4; j++)
            {
                if (!matchedSecret[j] && guess[i] == secret[j])
                {
                    wounded++;
                    matchedSecret[j] = true;
                    matchedGuess[i] = true;
                    break;
                }
            }
        }

        return new Score(dead, wounded);
    }

    internal static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "GuessNumber.slnx")))
                return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException("Repository root was not found.");
    }

    internal static string Sha256(string text)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(text));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    internal static JsonSerializerOptions JsonOptions() => new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };
}

public sealed class ParityVector
{
    public Dictionary<string, RulesetVector> Rulesets { get; set; } = [];
    public List<ScoreVector> Scores { get; set; } = [];
    public FilterVector Filter { get; set; } = new();
}

public sealed class RulesetVector
{
    public int Count { get; set; }
    public string First { get; set; } = "";
    public string Last { get; set; } = "";
    public string Sha256 { get; set; } = "";
}

public sealed class ScoreVector
{
    public string Guess { get; set; } = "";
    public string Secret { get; set; } = "";
    public int Dead { get; set; }
    public int Wounded { get; set; }
    public int Points { get; set; }
}

public sealed class FilterVector
{
    public string Ruleset { get; set; } = "classic4";
    public string Secret { get; set; } = "";
    public List<ScoreVector> Steps { get; set; } = [];
    public int RemainingCount { get; set; }
    public string RemainingSha256 { get; set; } = "";
}
