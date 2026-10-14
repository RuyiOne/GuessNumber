"""Dead / wounded scoring. Distinct-digit results match GuessNumber.Engine.Scorer."""

from __future__ import annotations


def score(guess: str, secret: str) -> tuple[int, int, int]:
    if len(guess) != len(secret):
        raise ValueError("Guess and secret must be the same length.")
    dead = sum(left == right for left, right in zip(guess, secret))
    guess_digits = [0] * 10
    secret_digits = [0] * 10
    for symbol in guess:
        guess_digits[ord(symbol) - ord("0")] = 1
    for symbol in secret:
        secret_digits[ord(symbol) - ord("0")] = 1
    intersection = sum(guess_digits[digit] and secret_digits[digit] for digit in range(10))
    wounded = intersection - dead
    # TODO repeatsAllowed can make the set formula negative. Clamped, as in the engine.
    if wounded < 0:
        wounded = 0
    points = dead * 10 + wounded * 2
    return dead, wounded, points
