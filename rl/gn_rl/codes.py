"""Code lists generated the same way as GuessNumber.Engine.Ruleset."""

from __future__ import annotations


RULESETS = {
    "classic4": {"length": 4, "min_digit": 1, "max_digit": 9, "allow_repeats": False},
    "classic5": {"length": 5, "min_digit": 1, "max_digit": 9, "allow_repeats": False},
    "pool0to9": {"length": 4, "min_digit": 0, "max_digit": 9, "allow_repeats": False},
    # TODO spec §4 does not fix the repeatsAllowed shape. The engine default is 4 digits, 1–9, repeats allowed.
    "repeatsAllowed": {"length": 4, "min_digit": 1, "max_digit": 9, "allow_repeats": True},
}


def all_codes(name: str) -> list[str]:
    spec = RULESETS[name]
    length = spec["length"]
    low = spec["min_digit"]
    high = spec["max_digit"]
    repeats = spec["allow_repeats"]
    codes: list[str] = []
    buffer = ["0"] * length

    def walk(position: int, used: int) -> None:
        if position == length:
            codes.append("".join(buffer))
            return
        for digit in range(low, high + 1):
            bit = 1 << digit
            if not repeats and (used & bit):
                continue
            buffer[position] = chr(ord("0") + digit)
            walk(position + 1, used | bit)

    walk(0, 0)
    return codes


def neighbours_at_distance_two(code: str, name: str) -> list[str]:
    """N2(code): valid codes that differ in exactly two positions."""
    spec = RULESETS[name]
    low = spec["min_digit"]
    high = spec["max_digit"]
    repeats = spec["allow_repeats"]
    length = len(code)
    chars = list(code)
    found: list[str] = []
    for i in range(length):
        for j in range(i + 1, length):
            retained = 0
            for k in range(length):
                if k == i or k == j:
                    continue
                retained |= 1 << (ord(code[k]) - ord("0"))
            for d1 in range(low, high + 1):
                if d1 == ord(code[i]) - ord("0"):
                    continue
                if not repeats and (retained & (1 << d1)):
                    continue
                chars[i] = chr(ord("0") + d1)
                used = retained | (0 if repeats else (1 << d1))
                for d2 in range(low, high + 1):
                    if d2 == ord(code[j]) - ord("0"):
                        continue
                    if not repeats and (used & (1 << d2)):
                        continue
                    chars[j] = chr(ord("0") + d2)
                    found.append("".join(chars))
            chars[i] = code[i]
            chars[j] = code[j]
    return found
