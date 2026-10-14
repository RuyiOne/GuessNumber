"""Two-layer network, 128 units by default, with an optional duelling head."""

from __future__ import annotations

import numpy as np


class MLP:
    def __init__(self, in_dim: int, out_dim: int, hidden: int, duelling: bool, rng: np.random.Generator) -> None:
        self.duelling = duelling
        self.out_dim = out_dim
        scale1 = np.sqrt(2 / in_dim)
        scale2 = np.sqrt(2 / hidden)
        self.w1 = rng.normal(0, scale1, (in_dim, hidden)).astype(np.float32)
        self.b1 = np.zeros(hidden, dtype=np.float32)
        self.w2 = rng.normal(0, scale2, (hidden, hidden)).astype(np.float32)
        self.b2 = np.zeros(hidden, dtype=np.float32)
        if duelling:
            self.wv = rng.normal(0, scale2, (hidden, 1)).astype(np.float32)
            self.bv = np.zeros(1, dtype=np.float32)
            self.wa = rng.normal(0, scale2, (hidden, out_dim)).astype(np.float32)
            self.ba = np.zeros(out_dim, dtype=np.float32)
            self.wq = None
            self.bq = None
        else:
            self.wq = rng.normal(0, scale2, (hidden, out_dim)).astype(np.float32)
            self.bq = np.zeros(out_dim, dtype=np.float32)
            self.wv = self.bv = self.wa = self.ba = None
        self.cache: tuple | None = None

    def parameters(self) -> list[np.ndarray]:
        if self.duelling:
            return [self.w1, self.b1, self.w2, self.b2, self.wv, self.bv, self.wa, self.ba]
        return [self.w1, self.b1, self.w2, self.b2, self.wq, self.bq]

    def copy_from(self, other: MLP) -> None:
        for destination, source in zip(self.parameters(), other.parameters(), strict=True):
            destination[:] = source

    def forward(self, features: np.ndarray, legal: np.ndarray) -> np.ndarray:
        z1 = features @ self.w1 + self.b1
        h1 = np.maximum(z1, 0)
        z2 = h1 @ self.w2 + self.b2
        h2 = np.maximum(z2, 0)
        if self.duelling:
            value = h2 @ self.wv + self.bv
            advantage = h2 @ self.wa + self.ba
            legal_f = legal.astype(np.float32)
            denominator = np.maximum(legal_f.sum(axis=1, keepdims=True), 1.0)
            mean_legal = (advantage * legal_f).sum(axis=1, keepdims=True) / denominator
            q_values = value + advantage - mean_legal
        else:
            value = advantage = mean_legal = None
            q_values = h2 @ self.wq + self.bq
        self.cache = (features, z1, h1, z2, h2, legal, value, advantage, mean_legal)
        return np.where(legal, q_values, -1e9).astype(np.float32)

    def backward(self, d_q: np.ndarray) -> list[np.ndarray]:
        features, z1, h1, z2, h2, legal, _value, _advantage, _mean = self.cache
        if self.duelling:
            legal_f = legal.astype(np.float32)
            denominator = np.maximum(legal_f.sum(axis=1, keepdims=True), 1.0)
            d_value = d_q.sum(axis=1, keepdims=True)
            d_mean = -d_q.sum(axis=1, keepdims=True)
            d_advantage = d_q + d_mean * (legal_f / denominator)
            d_h2 = d_value @ self.wv.T + d_advantage @ self.wa.T
            d_wv = h2.T @ d_value
            d_bv = d_value.sum(axis=0)
            d_wa = h2.T @ d_advantage
            d_ba = d_advantage.sum(axis=0)
            head = (d_wv, d_bv, d_wa, d_ba)
        else:
            d_h2 = d_q @ self.wq.T
            head = (h2.T @ d_q, d_q.sum(axis=0))
        d_z2 = d_h2 * (z2 > 0)
        d_h1 = d_z2 @ self.w2.T
        d_w2 = h1.T @ d_z2
        d_b2 = d_z2.sum(axis=0)
        d_z1 = d_h1 * (z1 > 0)
        d_w1 = features.T @ d_z1
        d_b1 = d_z1.sum(axis=0)
        if self.duelling:
            return [d_w1, d_b1, d_w2, d_b2, *head]
        return [d_w1, d_b1, d_w2, d_b2, head[0], head[1]]


class Adam:
    def __init__(self, parameters: list[np.ndarray], learning_rate: float) -> None:
        self.parameters = parameters
        self.learning_rate = learning_rate
        self.moment = [np.zeros_like(parameter) for parameter in parameters]
        self.velocity = [np.zeros_like(parameter) for parameter in parameters]
        self.step_count = 0

    def step(self, gradients: list[np.ndarray], clip: float = 10.0) -> None:
        norm = float(np.sqrt(sum(float(np.square(gradient).sum()) for gradient in gradients)))
        scale = 1.0 if norm <= clip or norm == 0 else clip / norm
        self.step_count += 1
        for index, gradient in enumerate(gradients):
            gradient = gradient * scale
            self.moment[index] = 0.9 * self.moment[index] + 0.1 * gradient
            self.velocity[index] = 0.999 * self.velocity[index] + 0.001 * np.square(gradient)
            moment = self.moment[index] / (1 - 0.9**self.step_count)
            velocity = self.velocity[index] / (1 - 0.999**self.step_count)
            self.parameters[index] -= self.learning_rate * moment / (np.sqrt(velocity) + 1e-8)
