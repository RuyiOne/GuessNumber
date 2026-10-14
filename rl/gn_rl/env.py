"""Single-agent Numero environment. The opponent's secret is hidden; feedback is public."""

from __future__ import annotations

import numpy as np

from .belief import Belief
from .codes import all_codes
from .scoring import score


class NumeroEnv:
    """Gymnasium-style reset/step without requiring the Gymnasium package.

    Reward follows the legacy split used by R0: 100 when the code is solved, otherwise
    the shaped points dead*10 + wounded*2, or 0 when reward_mode is sparse.
    """

    def __init__(
        self,
        ruleset: str = "classic4",
        reward_mode: str = "shaped",
        number_change: str = "off",
        notify_on_change: bool = True,
        max_guesses: int = 20,
        configuration: str = "r1",
        seed: int = 0,
    ) -> None:
        if reward_mode not in ("shaped", "sparse"):
            raise ValueError("reward_mode must be shaped or sparse.")
        if number_change not in ("off", "on"):
            raise ValueError("number_change must be off or on.")
        if configuration not in ("r0", "r1"):
            raise ValueError("configuration must be r0 or r1.")
        self.ruleset = ruleset
        self.reward_mode = reward_mode
        self.number_change = number_change
        self.notify_on_change = notify_on_change
        self.max_guesses = max_guesses
        self.configuration = configuration
        self.codes = all_codes(ruleset)
        self.belief = Belief(self.codes, ruleset)
        self.rng = np.random.default_rng(seed)
        self.length = len(self.codes[0])
        self.secret = self.codes[0]
        self.guessed: set[str] = set()
        self.turn = 1
        self.guesses = 0
        self.changes = 0
        self.last_dead = 0
        self.last_wounded = 0
        self._changed_this_step = False

    @property
    def observation_size(self) -> int:
        if self.configuration == "r0":
            return 1
        return len(self.codes) + 3

    @property
    def action_size(self) -> int:
        return len(self.codes)

    def reset(self, seed: int | None = None) -> tuple[np.ndarray, dict]:
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self.secret = self.codes[int(self.rng.integers(len(self.codes)))]
        self.belief.reset()
        self.guessed = set()
        self.turn = 1
        self.guesses = 0
        self.changes = 0
        self.last_dead = 0
        self.last_wounded = 0
        self._changed_this_step = False
        return self.observation(), {"secret_length": self.length, "legal": self.legal_mask()}

    def legal_mask(self) -> np.ndarray:
        mask = np.zeros(self.action_size, dtype=bool)
        if self.configuration == "r0":
            count = len(self._r0_pool())
            mask[:count] = True
            return mask
        for index, code in enumerate(self.codes):
            mask[index] = self.belief.alive[index] and code not in self.guessed
        if not mask.any():
            for index, alive in enumerate(self.belief.alive):
                mask[index] = alive
        return mask

    def observation(self) -> np.ndarray:
        if self.configuration == "r0":
            # Legacy TF.js agent fed a constant state. The action index, not the vector, carries the guess.
            return np.ones(1, dtype=np.float32)
        mask = np.asarray(self.belief.alive, dtype=np.float32)
        extras = np.array(
            [
                self.turn / self.max_guesses,
                self.last_dead / self.length,
                self.last_wounded / self.length,
            ],
            dtype=np.float32,
        )
        return np.concatenate([mask, extras])

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        if self.configuration == "r0":
            pool = self._r0_pool()
            if action < 0 or action >= len(pool):
                info = {"illegal": True, "legal": self.legal_mask(), "changed": False, "stale": False}
                return self.observation(), -1.0, False, False, info
            guess = pool[action]
        elif action < 0 or action >= self.action_size:
            info = {"illegal": True, "legal": self.legal_mask(), "changed": False, "stale": False}
            return self.observation(), -1.0, False, False, info
        else:
            # Any ruleset code is a legal guess. The belief mask only constrains the learned policy.
            guess = self.codes[action]
        self.guessed.add(guess)
        dead, wounded, points = score(guess, self.secret)
        solved = dead == self.length
        reward = 100.0 if solved else (float(points) if self.reward_mode == "shaped" else 0.0)
        self.last_dead = dead
        self.last_wounded = wounded
        self.guesses += 1
        self.belief.observe(guess, dead, wounded, self.turn)
        changed = False
        if (
            not solved
            and self.number_change == "on"
            and self.changes == 0
            and (dead == 3 or self.belief.count <= 6)
        ):
            changed = self._change_secret()
        self._changed_this_step = changed
        self.turn += 1
        terminated = solved
        truncated = (not solved) and self.guesses >= self.max_guesses
        info = {
            "illegal": False,
            "guess": guess,
            "dead": dead,
            "wounded": wounded,
            "solved": solved,
            "changed": changed,
            "stale": changed,
            "legal": self.legal_mask(),
            "generation": self.belief.generation,
        }
        return self.observation(), reward, terminated, truncated, info

    def _r0_pool(self) -> list[str]:
        pool = [code for code, alive in zip(self.codes, self.belief.alive) if alive and code not in self.guessed]
        if pool:
            return pool
        return [code for code, alive in zip(self.codes, self.belief.alive) if alive]

    def _change_secret(self) -> bool:
        for _ in range(64):
            candidate = self.codes[int(self.rng.integers(len(self.codes)))]
            if sum(left != right for left, right in zip(candidate, self.secret)) == 2:
                self.secret = candidate
                self.changes += 1
                if self.notify_on_change:
                    self.belief.on_announced_change(self.turn)
                    self.guessed.clear()
                return True
        return False
