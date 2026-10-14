"""DQN, Double DQN, Duelling DQN, and Double + Duelling."""

from __future__ import annotations

import numpy as np

from .net import Adam, MLP
from .replay import ReplayBuffer, Transition

AGENTS = ("dqn", "double", "duelling", "doubleDuelling")


class QAgent:
    def __init__(self, spec: dict, observation_size: int, action_size: int, rng: np.random.Generator) -> None:
        if spec["agent"] not in AGENTS:
            raise ValueError(f"Unknown agent '{spec['agent']}'.")
        self.spec = spec
        self.rng = rng
        self.action_size = action_size
        self.configuration = spec["configuration"]
        self.double = spec["agent"] in ("double", "doubleDuelling")
        duelling = spec["agent"] in ("duelling", "doubleDuelling")
        self.online = MLP(observation_size, action_size, spec["hidden"], duelling, rng)
        self.target = MLP(observation_size, action_size, spec["hidden"], duelling, np.random.default_rng(0))
        self.target.copy_from(self.online)
        self.optimiser = Adam(self.online.parameters(), spec["learning_rate"])
        self.replay = ReplayBuffer(
            spec["buffer_size"],
            prioritised=spec["per"],
            legacy=spec["configuration"] == "r0" and spec["per"],
            alpha=spec["alpha"],
            rng=rng,
        )
        self.epsilon = spec["epsilon_start"]
        self.learn_steps = 0
        self.generation = 0
        self._boost_steps = 0

    def act(self, observation: np.ndarray, legal: np.ndarray) -> int:
        epsilon = min(1.0, self.epsilon + 0.2) if self._boost_steps > 0 else self.epsilon
        if self._boost_steps > 0:
            self._boost_steps -= 1
        legal_index = np.flatnonzero(legal)
        if legal_index.size == 0:
            return 0
        if self.rng.random() < epsilon:
            if self.configuration == "r0":
                # Legacy exploration: floor(r * |legal|), which crowds the low indices.
                return int(self.rng.random() * legal_index.size)
            return int(self.rng.choice(legal_index))
        q_values = self.online.forward(observation[None, :], legal[None, :])[0]
        return int(np.argmax(q_values))

    def note_change(self) -> None:
        self.generation += 1
        self._boost_steps = 1

    def push(
        self,
        state: np.ndarray,
        action: int,
        reward: float,
        next_state: np.ndarray,
        done: bool,
        legal: np.ndarray,
        next_legal: np.ndarray,
    ) -> dict[str, float]:
        self.replay.add(
            Transition(
                self._pack_state(state),
                action,
                reward,
                self._pack_state(next_state),
                done,
                np.packbits(legal),
                np.packbits(next_legal),
                self.generation,
                self._extras(state),
                self._extras(next_state),
            )
        )
        if len(self.replay) < self.spec["batch_size"]:
            return {}
        return self._learn()

    def end_episode(self, progress: float) -> None:
        self.epsilon = max(self.spec["epsilon_end"], self.epsilon * self.spec["epsilon_decay"])
        self._progress = progress

    def _beta(self) -> float:
        progress = getattr(self, "_progress", 0.0)
        if self.configuration == "r0":
            return self.spec["beta"]
        return self.spec["beta"] + (1.0 - self.spec["beta"]) * progress

    def _pack_state(self, observation: np.ndarray) -> np.ndarray:
        if self.configuration == "r0":
            return observation.astype(np.float32, copy=True)
        return np.packbits(observation[: self.action_size] > 0.5)

    def _extras(self, observation: np.ndarray) -> np.ndarray | None:
        if self.configuration == "r0":
            return None
        return observation[self.action_size :].astype(np.float32, copy=True)

    def _restore_state(self, packed: np.ndarray, extras: np.ndarray | None) -> np.ndarray:
        if self.configuration == "r0":
            return packed
        mask = np.unpackbits(packed, count=self.action_size).astype(np.float32)
        return np.concatenate([mask, extras])

    def _restore_legal(self, packed: np.ndarray) -> np.ndarray:
        return np.unpackbits(packed, count=self.action_size).astype(bool)

    def _learn(self) -> dict[str, float]:
        batch, indices, weights, _priorities = self.replay.sample(self.spec["batch_size"], self._beta())
        states = np.stack([self._restore_state(item.state, item.extras) for item in batch])
        next_states = np.stack([self._restore_state(item.next_state, item.next_extras) for item in batch])
        legal = np.stack([self._restore_legal(item.legal) for item in batch])
        next_legal = np.stack([self._restore_legal(item.next_legal) for item in batch])
        actions = np.array([item.action for item in batch], dtype=np.int64)
        rewards = np.array([item.reward for item in batch], dtype=np.float32)
        done = np.array([item.done for item in batch], dtype=np.float32)

        q_values = self.online.forward(states, legal)
        chosen = q_values[np.arange(len(batch)), actions]
        next_online = self.online.forward(next_states, next_legal)
        next_target = self.target.forward(next_states, next_legal)
        if self.double:
            next_actions = np.argmax(next_online, axis=1)
            next_values = next_target[np.arange(len(batch)), next_actions]
        else:
            next_values = next_target.max(axis=1)
        targets = rewards + self.spec["gamma"] * next_values * (1.0 - done)
        td = targets - chosen
        d_q = np.zeros_like(q_values)
        d_q[np.arange(len(batch)), actions] = (-2.0 * weights * td / len(batch)).astype(np.float32)
        # The forward used for chosen Q is the first call. Recompute so backward sees that cache.
        self.online.forward(states, legal)
        gradients = self.online.backward(d_q)
        self.optimiser.step(gradients)
        self.replay.update(indices, td)
        self.learn_steps += 1
        if self.learn_steps % self.spec["target_interval"] == 0:
            self.target.copy_from(self.online)

        stale = np.array([item.generation < self.generation for item in batch], dtype=np.float32)
        return {
            "loss": float(np.mean(weights * np.square(td))),
            "td_error": float(np.mean(np.abs(td))),
            "priority": float(np.mean(np.abs(td) + 1e-6)),
            "is_weight": float(np.mean(weights)),
            "stale_fraction": float(np.mean(stale)),
        }
