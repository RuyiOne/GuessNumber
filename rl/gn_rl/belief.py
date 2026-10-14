"""Candidate sets consistent with public feedback, including an announced two-position change."""

from __future__ import annotations

from .codes import neighbours_at_distance_two
from .scoring import score


class Belief:
    def __init__(self, codes: list[str], ruleset: str) -> None:
        self.codes = codes
        self.ruleset = ruleset
        self.history: list[tuple[str, int, int, int]] = []
        self.alive = [True] * len(codes)
        self.generation = 0

    def reset(self) -> None:
        self.history.clear()
        self.alive = [True] * len(self.codes)
        self.generation = 0

    def observe(self, guess: str, dead: int, wounded: int, turn: int) -> None:
        self.history.append((guess, dead, wounded, turn))
        self.alive = [flag and self._matches(code, [(guess, dead, wounded)]) for flag, code in zip(self.alive, self.codes)]
        if not any(self.alive):
            self._recover_unannounced()

    def on_announced_change(self, turn: int) -> None:
        self.generation += 1
        pre = [code for code in self.codes if self._consistent_before(code, turn)]
        expanded: set[str] = set()
        for code in pre:
            expanded.update(neighbours_at_distance_two(code, self.ruleset))
        self.alive = [code in expanded and self._consistent_from(code, turn) for code in self.codes]

    @property
    def count(self) -> int:
        return sum(self.alive)

    def candidates(self) -> list[str]:
        return [code for code, flag in zip(self.codes, self.alive) if flag]

    def _matches(self, code: str, observations: list[tuple[str, int, int]]) -> bool:
        for guess, dead, wounded in observations:
            got_dead, got_wounded, _points = score(guess, code)
            if got_dead != dead or got_wounded != wounded:
                return False
        return True

    def _consistent_before(self, code: str, turn: int) -> bool:
        observations = [(guess, dead, wounded) for guess, dead, wounded, seen in self.history if seen < turn]
        return self._matches(code, observations)

    def _consistent_from(self, code: str, turn: int) -> bool:
        observations = [(guess, dead, wounded) for guess, dead, wounded, seen in self.history if seen >= turn]
        return self._matches(code, observations)

    def _recover_unannounced(self) -> None:
        turns = sorted({item[3] for item in self.history}, reverse=True)
        for turn in turns:
            pre = [code for code in self.codes if self._consistent_before(code, turn)]
            expanded: set[str] = set()
            for code in pre:
                expanded.update(neighbours_at_distance_two(code, self.ruleset))
            alive = [code in expanded and self._consistent_from(code, turn) for code in self.codes]
            if any(alive):
                self.alive = alive
                self.generation += 1
                return
        last = self.history[-2:]
        observations = [(guess, dead, wounded) for guess, dead, wounded, _turn in last]
        self.alive = [self._matches(code, observations) for code in self.codes]
        self.generation += 1
