namespace GuessNumber.Engine.Tests;

public class ChangeEdgeCaseTests
{
    [Fact]
    public void E1_score_below_25_is_rejected_and_the_turn_is_kept()
    {
        var game = Started();
        var guess = game.SubmitGuess(0, "5687");
        Assert.True(guess.Ok);
        Assert.Equal(24, guess.Value!.PointsDelta);
        Assert.Equal(24, game.Scores[0]);
        Pass(game);

        var turn = game.Turn;
        var result = game.ChangeSecret(0, [2, 3], ['5', '6']);
        Assert.Equal(GameErrorCodes.InsufficientScore, result.ErrorCode);
        Assert.Equal(24, game.Scores[0]);
        Assert.Equal("1234", game.Secrets[0]);
        Assert.Equal(0, game.CurrentPlayer);
        Assert.Equal(turn, game.Turn);
        Assert.Equal(2, game.Moves.Count);
    }

    [Fact]
    public void E2_second_change_in_once_mode_is_rejected()
    {
        var game = Started();
        ScoreThirty(game);
        var first = game.ChangeSecret(0, [2, 3], ['4', '3']);
        Assert.True(first.Ok);
        Assert.Equal("1243", game.Secrets[0]);
        Pass(game);
        ScoreThirty(game);

        var second = game.ChangeSecret(0, [2, 3], ['3', '4']);
        Assert.Equal(GameErrorCodes.ChangeLimitReached, second.ErrorCode);
        Assert.Equal("1243", game.Secrets[0]);
        Assert.Equal(1, game.ChangesUsed[0]);
    }

    [Fact]
    public void E3_repeated_digit_or_zero_is_rejected_and_a_swap_is_allowed()
    {
        var game = Started();
        ScoreThirty(game);
        var repeat = game.ChangeSecret(0, [2, 3], ['1', '1']);
        Assert.Equal(GameErrorCodes.InvalidCode, repeat.ErrorCode);
        Assert.Contains("repeats a digit", repeat.ErrorMessage);

        var zero = game.ChangeSecret(0, [2, 3], ['5', '0']);
        Assert.Equal(GameErrorCodes.InvalidCode, zero.ErrorCode);
        Assert.Contains("0 is not allowed", zero.ErrorMessage);
        Assert.Equal("1234", game.Secrets[0]);

        var swap = game.ChangeSecret(0, [2, 3], ['4', '3']);
        Assert.True(swap.Ok);
        Assert.Equal("1243", game.Secrets[0]);
    }

    [Fact]
    public void E4_fewer_or_more_than_two_positions_is_rejected()
    {
        var game = Started();
        ScoreThirty(game);

        var one = game.ChangeSecret(0, [2], ['9']);
        Assert.Equal(GameErrorCodes.InvalidChangeCount, one.ErrorCode);

        var three = game.ChangeSecret(0, [1, 2, 3], ['9', '8', '7']);
        Assert.Equal(GameErrorCodes.InvalidChangeCount, three.ErrorCode);

        var unchanged = game.ChangeSecret(0, [2, 3], ['3', '4']);
        Assert.Equal(GameErrorCodes.InvalidChangeCount, unchanged.ErrorCode);
        Assert.Equal("1234", game.Secrets[0]);
        Assert.Equal(0, game.ChangesUsed[0]);
    }

    [Fact]
    public void E5_changing_to_a_code_the_opponent_already_guessed_keeps_the_old_feedback()
    {
        var game = Started(p0: "1234", p1: "5678");
        Assert.True(game.SubmitGuess(0, "9876").Ok);
        var earlier = game.SubmitGuess(1, "1243");
        Assert.True(earlier.Ok);
        Assert.Equal(2, earlier.Value!.Dead);
        Assert.Equal(2, earlier.Value.Wounded);

        ScoreThirty(game);
        var change = game.ChangeSecret(0, [2, 3], ['4', '3']);
        Assert.True(change.Ok);
        Assert.Equal("1243", game.Secrets[0]);
        Assert.Null(change.Value!.Guess);
        Assert.Equal(2, game.Moves[1].Dead);
        Assert.Equal(2, game.Moves[1].Wounded);
    }

    [Fact]
    public void E6_returning_to_an_earlier_secret_is_allowed_and_logged()
    {
        var settings = new GameSettings(NumberChange: NumberChangeModes.Unlimited);
        var game = Started(settings: settings);
        ScoreThirty(game);
        var away = game.ChangeSecret(0, [2, 3], ['4', '3']);
        Assert.True(away.Ok);
        Assert.False(away.Value!.RevisitedPreviousSecret);

        Pass(game);
        ScoreThirty(game);
        var back = game.ChangeSecret(0, [2, 3], ['3', '4']);
        Assert.True(back.Ok);
        Assert.Equal("1234", game.Secrets[0]);
        Assert.True(back.Value!.RevisitedPreviousSecret);
    }

    [Fact]
    public void E7_a_change_after_a_solving_guess_is_rejected()
    {
        var game = Started(p0: "1234", p1: "5678");
        var solved = game.SubmitGuess(0, "5678");
        Assert.True(solved.Ok);
        Assert.Equal(40, solved.Value!.PointsDelta);
        Assert.Equal(GamePhase.Finished, game.Phase);
        Assert.Equal(0, game.Winner);

        var change = game.ChangeSecret(1, [0, 1], ['6', '5']);
        Assert.Equal(GameErrorCodes.GameOver, change.ErrorCode);
        Assert.Equal("5678", game.Secrets[1]);
    }

    [Fact]
    public void E8_changes_are_disabled_on_the_equal_turns_final_turn()
    {
        var game = Started(p0: "1234", p1: "5678", settings: new GameSettings(EqualTurns: true));
        var solved = game.SubmitGuess(0, "5678");
        Assert.True(solved.Ok);
        Assert.Equal(GamePhase.FinalTurn, game.Phase);
        Assert.Equal(1, game.CurrentPlayer);

        var change = game.ChangeSecret(1, [0, 1], ['2', '1']);
        Assert.Equal(GameErrorCodes.ChangeDisabledFinalTurn, change.ErrorCode);
        Assert.Equal(GamePhase.FinalTurn, game.Phase);
        Assert.Equal(1, game.CurrentPlayer);

        var last = game.SubmitGuess(1, "1234");
        Assert.True(last.Ok);
        Assert.Equal(GamePhase.Finished, game.Phase);
        Assert.Equal(0, game.Winner);
    }

    [Fact]
    public void E9_a_change_and_a_guess_cannot_both_apply_on_one_turn()
    {
        var game = Started();
        ScoreThirty(game);
        var change = game.ChangeSecret(0, [2, 3], ['4', '3']);
        Assert.True(change.Ok);
        Assert.Equal(1, game.CurrentPlayer);

        var guess = game.SubmitGuess(0, "5678");
        Assert.Equal(GameErrorCodes.NotYourTurn, guess.ErrorCode);
        Assert.Equal(3, game.Moves.Count);
        Assert.Equal(MoveKind.Change, game.Moves[^1].Kind);
        Assert.Equal("5678", game.Secrets[1]);
    }

    [Fact]
    public void E10_nothing_is_committed_until_the_change_is_accepted()
    {
        var game = Started();
        ScoreThirty(game);
        game.ArmTurnTimer(new DateTimeOffset(2026, 10, 13, 12, 0, 0, TimeSpan.Zero));
        var deadline = game.TurnDeadlineUtc;

        var snapshot = (
            game.Secrets[0],
            game.Scores[0],
            game.Turn,
            game.Phase,
            game.CurrentPlayer,
            game.Moves.Count,
            game.ChangesUsed[0],
            game.Notifications.Count);

        var rejected = game.ChangeSecret(0, [2, 3], ['1', '1']);
        Assert.Equal(GameErrorCodes.InvalidCode, rejected.ErrorCode);
        Assert.Equal(snapshot, (
            game.Secrets[0],
            game.Scores[0],
            game.Turn,
            game.Phase,
            game.CurrentPlayer,
            game.Moves.Count,
            game.ChangesUsed[0],
            game.Notifications.Count));
        Assert.Equal(deadline, game.TurnDeadlineUtc);

        var accepted = game.ChangeSecret(0, [2, 3], ['4', '3']);
        Assert.True(accepted.Ok);
        Assert.Equal("1243", game.Secrets[0]);
        Assert.Contains(accepted.Value!.Turn, game.ToPublicView().AnnouncedChangeTurns);
        Assert.DoesNotContain(game.ToPublicView().Moves, m => m.Guess == "1243");
    }

    [Fact]
    public void Disabled_mode_rejects_a_change_and_silence_omits_the_announcement()
    {
        var silent = Started(settings: new GameSettings(NumberChange: NumberChangeModes.Unlimited, NotifyOnChange: false));
        ScoreThirty(silent);
        var change = silent.ChangeSecret(0, [2, 3], ['4', '3']);
        Assert.True(change.Ok);
        Assert.Empty(silent.Notifications);
        Assert.Empty(silent.ToPublicView().AnnouncedChangeTurns);
        Assert.Equal(-25, silent.ToPublicView().Moves[^1].PointsDelta);

        var disabled = Started(settings: new GameSettings(NumberChange: NumberChangeModes.Disabled));
        ScoreThirty(disabled);
        Assert.Equal(GameErrorCodes.ChangeDisabled, disabled.ChangeSecret(0, [2, 3], ['4', '3']).ErrorCode);
    }

    [Fact]
    public void Classic5_does_not_end_on_four_dead()
    {
        var game = new Game(new GameSettings(Ruleset: "classic5"));
        Assert.True(game.SetSecret(0, "12345").Ok);
        Assert.True(game.SetSecret(1, "98765").Ok);
        var partial = game.SubmitGuess(0, "98761");
        Assert.True(partial.Ok);
        Assert.Equal(4, partial.Value!.Dead);
        Assert.Equal(GamePhase.InProgress, game.Phase);
    }

    [Fact]
    public void Public_view_never_contains_a_secret()
    {
        var game = Started(p0: "1234", p1: "5678");
        ScoreThirty(game);
        Assert.True(game.ChangeSecret(0, [2, 3], ['4', '3']).Ok);
        var json = System.Text.Json.JsonSerializer.Serialize(game.ToPublicView());
        Assert.DoesNotContain("1243", json);
        Assert.DoesNotContain("1234", json);
    }

    private static Game Started(string p0 = "1234", string p1 = "5678", GameSettings? settings = null)
    {
        var game = new Game(settings ?? new GameSettings());
        Assert.True(game.SetSecret(0, p0).Ok);
        Assert.True(game.SetSecret(1, p1).Ok);
        Assert.Equal(GamePhase.InProgress, game.Phase);
        return game;
    }

    private static void ScoreThirty(Game game)
    {
        Assert.Equal(0, game.CurrentPlayer);
        var result = game.SubmitGuess(0, GuessWorthThirty(game.Secrets[1]!));
        Assert.True(result.Ok);
        Assert.Equal(1, game.CurrentPlayer);
        Pass(game);
    }

    private static void Pass(Game game)
    {
        Assert.Equal(1, game.CurrentPlayer);
        var result = game.SubmitGuess(1, "9876");
        Assert.True(result.Ok);
        Assert.Equal(0, result.Value!.PointsDelta);
    }

    private static string GuessWorthThirty(string secret)
    {
        var chars = secret.ToCharArray();
        var last = chars[^1];
        chars[^1] = last == '9' ? '8' : '9';
        var guess = new string(chars);
        var score = Scorer.Score(guess, secret);
        Assert.Equal(3, score.Dead);
        Assert.Equal(30, score.Points);
        return guess;
    }
}
