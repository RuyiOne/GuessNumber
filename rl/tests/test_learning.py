import numpy as np

from gn_rl.net import MLP
from gn_rl.replay import ReplayBuffer, Transition


def _transition(action: int) -> Transition:
    return Transition(
        state=np.zeros(1, dtype=np.float32),
        action=action,
        reward=1.0,
        next_state=np.zeros(1, dtype=np.float32),
        done=False,
        legal=np.ones(2, dtype=bool),
        next_legal=np.ones(2, dtype=bool),
        generation=0,
    )


def test_uniform_minibatch_has_no_repeated_index():
    rng = np.random.default_rng(0)
    buffer = ReplayBuffer(32, prioritised=False, legacy=False, alpha=0.4, rng=rng)
    for action in range(10):
        buffer.add(_transition(action))
    _batch, indices, _weights, _priorities = buffer.sample(8, beta=0.5)
    assert len(indices) == len(set(indices.tolist()))


def test_legacy_per_raises_the_priority_by_alpha_and_samples_with_beta():
    rng = np.random.default_rng(1)
    legacy = ReplayBuffer(8, prioritised=True, legacy=True, alpha=0.5, rng=rng)
    standard = ReplayBuffer(8, prioritised=True, legacy=False, alpha=0.5, rng=np.random.default_rng(1))
    legacy.add(_transition(0))
    standard.add(_transition(0))
    legacy.update(np.array([0]), np.array([16.0]))
    standard.update(np.array([0]), np.array([16.0]))
    # |td|+eps is about 16. Legacy stores 16^alpha. Standard stores 16.
    assert legacy.priorities[0] < standard.priorities[0]
    assert abs(legacy.priorities[0] - (16.0 + 1e-6) ** 0.5) < 1e-4


def test_duelling_q_is_value_plus_advantage_minus_the_legal_mean():
    net = MLP(2, 3, 4, duelling=True, rng=np.random.default_rng(2))
    features = np.ones((2, 2), dtype=np.float32)
    legal = np.array([[True, True, False], [True, True, True]])
    q_values = net.forward(features, legal)
    _features, _z1, _h1, _z2, _h2, _legal, value, advantage, mean = net.cache
    expected = np.where(legal, value + advantage - mean, -1e9)
    assert np.allclose(q_values, expected, atol=1e-5)


def test_selected_action_gradient_matches_a_finite_difference():
    rng = np.random.default_rng(3)
    net = MLP(2, 2, 3, duelling=False, rng=rng)
    features = rng.normal(size=(1, 2)).astype(np.float32)
    legal = np.ones((1, 2), dtype=bool)
    net.forward(features, legal)
    d_q = np.zeros((1, 2), dtype=np.float32)
    d_q[0, 0] = 1.0
    gradients = net.backward(d_q)
    epsilon = 1e-3
    original = float(net.w1[0, 0])
    net.w1[0, 0] = original + epsilon
    plus = float(net.forward(features, legal)[0, 0])
    net.w1[0, 0] = original - epsilon
    minus = float(net.forward(features, legal)[0, 0])
    net.w1[0, 0] = original
    finite = (plus - minus) / (2 * epsilon)
    assert abs(finite - float(gradients[0][0, 0])) < 1e-2
