"""Replay buffers. PER-off draws a minibatch without replacement. R0 repeats the PER exponent."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Transition:
    state: np.ndarray
    action: int
    reward: float
    next_state: np.ndarray
    done: bool
    legal: np.ndarray
    next_legal: np.ndarray
    generation: int
    extras: np.ndarray | None = None
    next_extras: np.ndarray | None = None


class ReplayBuffer:
    def __init__(self, capacity: int, prioritised: bool, legacy: bool, alpha: float, rng: np.random.Generator) -> None:
        self.capacity = capacity
        self.prioritised = prioritised
        self.legacy = legacy
        self.alpha = alpha
        self.rng = rng
        self.items: list[Transition] = []
        self.priorities: list[float] = []
        self.position = 0

    def __len__(self) -> int:
        return len(self.items)

    def add(self, transition: Transition, priority: float | None = None) -> None:
        stored = 1.0 if priority is None else float(priority)
        if len(self.items) < self.capacity:
            self.items.append(transition)
            self.priorities.append(stored)
            return
        self.items[self.position] = transition
        self.priorities[self.position] = stored
        self.position = (self.position + 1) % self.capacity

    def sample(self, batch_size: int, beta: float) -> tuple[list[Transition], np.ndarray, np.ndarray, np.ndarray]:
        size = len(self.items)
        count = min(batch_size, size)
        priorities = np.asarray(self.priorities, dtype=np.float64)
        if not self.prioritised:
            indices = self.rng.choice(size, size=count, replace=False)
            weights = np.ones(count, dtype=np.float32)
        else:
            # Standard PER samples with p^alpha. The legacy buffer already stored p^alpha,
            # then samples with that value raised to beta again.
            exponent = beta if self.legacy else self.alpha
            scaled = np.power(np.maximum(priorities, 1e-8), exponent)
            probabilities = scaled / scaled.sum()
            indices = self.rng.choice(size, size=count, replace=False, p=probabilities)
            weights = np.power(size * probabilities[indices], -beta)
            weights = (weights / weights.max()).astype(np.float32)
        picked = [self.items[int(index)] for index in indices]
        return picked, indices.astype(np.int64), weights, priorities[indices].astype(np.float32)

    def update(self, indices: np.ndarray, td_error: np.ndarray) -> None:
        for index, error in zip(indices, td_error, strict=True):
            magnitude = abs(float(error)) + 1e-6
            if self.legacy:
                self.priorities[int(index)] = float(magnitude**self.alpha)
            else:
                self.priorities[int(index)] = magnitude
