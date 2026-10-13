namespace GuessNumber.Engine.Tests;

public class SworSolverTests
{
    [Fact]
    public void Solves_classic4_within_ten_guesses_for_five_hundred_seeds()
    {
        var rules = Ruleset.Classic4;
        var codes = rules.AllCodes;
        var worst = 0;
        var total = 0;

        for (var seed = 0; seed < 500; seed++)
        {
            var random = new Random(seed);
            var secret = codes[random.Next(codes.Count)];
            var solver = new SworSolver();
            solver.Reset(rules, seed);

            var guesses = 0;
            var solved = false;
            while (guesses < 40)
            {
                var guess = solver.NextGuess();
                guesses++;
                var score = Scorer.Score(guess, secret);
                solver.Observe(guess, score.Dead, score.Wounded);
                if (score.Dead == 4)
                {
                    solved = true;
                    break;
                }
            }

            Assert.True(solved, $"Seed {seed} did not solve. Secret {secret}.");
            worst = Math.Max(worst, guesses);
            total += guesses;
            Assert.True(guesses <= 10, $"Seed {seed} took {guesses} guesses. Secret {secret}.");
        }

        Assert.InRange(total / 500.0, 1, 8);
        Assert.InRange(worst, 1, 10);
    }

    [Fact]
    public void Recovers_after_an_announced_change()
    {
        var solver = new SworSolver();
        solver.Reset(Ruleset.Classic4, 7);
        var secret = "1234";
        Play(solver, ref secret, 2);

        secret = "1243";
        solver.OnOpponentChange(3);
        Assert.Contains(secret, solver.Candidates);

        var guesses = PlayUntilSolved(solver, secret, 20);
        Assert.True(guesses <= 20);
    }

    [Fact]
    public void Recovers_after_an_unannounced_change()
    {
        var solver = new SworSolver();
        solver.Reset(Ruleset.Classic4, 11);
        const string oldSecret = "1234";
        const string newSecret = "1243";

        var guard = 0;
        while (solver.Candidates.Contains(newSecret) && guard < 40)
        {
            var guess = solver.Candidates.First(code => code != oldSecret);
            var score = Scorer.Score(guess, oldSecret);
            solver.Observe(guess, score.Dead, score.Wounded);
            guard++;
        }

        var emptying = FindEmptyingGuess(solver, newSecret);
        Assert.NotNull(emptying);
        var feedback = Scorer.Score(emptying, newSecret);
        Assert.NotEqual(4, feedback.Dead);
        solver.Observe(emptying, feedback.Dead, feedback.Wounded);

        Assert.Contains(newSecret, solver.Candidates);
        Assert.True(solver.Stats().Recoveries >= 1);
        var guesses = PlayUntilSolved(solver, newSecret, 20);
        Assert.True(guesses <= 20);
    }

    [Fact]
    public void Filtering_removes_codes_inconsistent_with_feedback()
    {
        var solver = new SworSolver();
        solver.Reset(Ruleset.Classic4, 1);
        solver.Observe("1234", 0, 0);
        Assert.Equal(120, solver.Candidates.Count);
        Assert.All(solver.Candidates, code =>
        {
            Assert.DoesNotContain('1', code);
            Assert.DoesNotContain('2', code);
            Assert.DoesNotContain('3', code);
            Assert.DoesNotContain('4', code);
        });
    }

    private static void Play(SworSolver solver, ref string secret, int turns)
    {
        for (var i = 0; i < turns; i++)
        {
            var guess = solver.NextGuess();
            var score = Scorer.Score(guess, secret);
            solver.Observe(guess, score.Dead, score.Wounded);
            Assert.NotEqual(4, score.Dead);
        }
    }

    private static int PlayUntilSolved(SworSolver solver, string secret, int cap)
    {
        for (var i = 1; i <= cap; i++)
        {
            var guess = solver.NextGuess();
            var score = Scorer.Score(guess, secret);
            solver.Observe(guess, score.Dead, score.Wounded);
            if (score.Dead == 4)
                return i;
        }

        return cap + 1;
    }

    private static string? FindEmptyingGuess(SworSolver solver, string secret)
    {
        if (solver.Candidates.Contains(secret))
            return null;

        foreach (var guess in Ruleset.Classic4.AllCodes)
        {
            var feedback = Scorer.Score(guess, secret);
            if (feedback.Dead == 4)
                continue;

            var survives = false;
            foreach (var candidate in solver.Candidates)
            {
                var score = Scorer.Score(guess, candidate);
                if (score.Dead == feedback.Dead && score.Wounded == feedback.Wounded)
                {
                    survives = true;
                    break;
                }
            }

            if (!survives)
                return guess;
        }

        return null;
    }
}
