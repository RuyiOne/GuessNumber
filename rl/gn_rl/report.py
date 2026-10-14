"""Summarise training logs. `python -m gn_rl.report runs/ --out paper_figs/`."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Write learning curves and comparison tables from run logs.")
    parser.add_argument("runs", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    rows = _read_runs(args.runs)
    if not rows:
        raise SystemExit(f"No parquet logs in {args.runs}.")
    args.out.mkdir(parents=True, exist_ok=True)
    _write_summary(args.out / "summary.csv", rows)
    _write_curves(args.out / "learning_curves.png", rows)
    _write_tests(args.out / "comparisons.csv", rows)
    print(f"Wrote {args.out}")


def _read_runs(folder: Path) -> list[dict]:
    import pyarrow.parquet as pq

    rows: list[dict] = []
    for path in sorted(folder.glob("*.parquet")):
        table = pq.read_table(path)
        rows.extend(table.to_pylist())
    return rows


def _group_key(row: dict) -> str:
    per = "per" if row["per"] else "uniform"
    return f"{row['configuration']}/{row['agent']}/{per}/{row['ruleset']}/{row['reward_mode']}"


def _write_summary(path: Path, rows: list[dict]) -> None:
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(_group_key(row), []).append(row)
    lines = ["group,episodes,seeds,mean_reward,iqm_reward,success_rate,episodes_to_95,mean_guesses,mean_loss,cumulative_reward_last"]
    for name, items in sorted(groups.items()):
        rewards = np.array([item["episode_reward"] for item in items], dtype=float)
        seeds = len({item["seed"] for item in items})
        success = np.mean([1.0 if item["success"] else 0.0 for item in items])
        guesses = np.mean([item["guesses"] for item in items])
        loss = np.mean([item["loss"] for item in items])
        last = max(items, key=lambda item: (item["seed"], item["episode"]))
        lines.append(
            f"{name},{len(items)},{seeds},{rewards.mean():.4f},{_iqm(rewards):.4f},{success:.4f},"
            f"{_episodes_to_95(items)},{guesses:.4f},{loss:.6f},{last['cumulative_reward']:.4f}"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_curves(path: Path, rows: list[dict]) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    groups: dict[str, dict[int, list[float]]] = {}
    for row in rows:
        groups.setdefault(_group_key(row), {}).setdefault(int(row["episode"]), []).append(float(row["episode_reward"]))
    figure, axis = plt.subplots(figsize=(8, 4.5))
    for name, episodes in sorted(groups.items()):
        xs = sorted(episodes)
        means = [float(np.mean(episodes[episode])) for episode in xs]
        axis.plot(xs, means, label=name)
        if any(len(episodes[episode]) >= 2 for episode in xs):
            low = []
            high = []
            for episode in xs:
                sample = np.array(episodes[episode], dtype=float)
                low.append(float(np.quantile(sample, 0.025)) if sample.size >= 2 else sample[0])
                high.append(float(np.quantile(sample, 0.975)) if sample.size >= 2 else sample[0])
            axis.fill_between(xs, low, high, alpha=0.15)
    axis.set_title("Mean episode reward")
    axis.set_xlabel("Episode")
    axis.set_ylabel("Reward")
    axis.legend(fontsize=7, loc="best")
    figure.tight_layout()
    figure.savefig(path, dpi=300)
    plt.close(figure)


def _write_tests(path: Path, rows: list[dict]) -> None:
    """Welch and Mann-Whitney contrasts against sampling without replacement, with Holm correction."""
    per_group: dict[str, list[float]] = {}
    for row in rows:
        if row["agent"] == "swor":
            key = f"swor/{row['ruleset']}/{row['reward_mode']}"
        else:
            key = _group_key(row)
        per_group.setdefault(key, []).append(float(row["episode_reward"]))
    swor_groups = {key: values for key, values in per_group.items() if key.startswith("swor/")}
    lines = ["contrast,n_a,n_b,mean_difference,cohens_d,welch_p,mannwhitney_p,holm_p"]
    raw: list[tuple[str, int, int, float, float, float, float]] = []
    for name, values in sorted(per_group.items()):
        if name.startswith("swor/"):
            continue
        ruleset = name.split("/")[3] if name.count("/") >= 3 else ""
        reward = name.split("/")[4] if name.count("/") >= 4 else ""
        reference = swor_groups.get(f"swor/{ruleset}/{reward}")
        if not reference:
            continue
        difference = float(np.mean(values) - np.mean(reference))
        effect = _cohens_d(values, reference)
        welch = _welch_p(values, reference)
        mann = _mannwhitney_p(values, reference)
        raw.append((f"{name} minus swor/{ruleset}/{reward}", len(values), len(reference), difference, effect, welch, mann))
    corrected = _holm([item[5] for item in raw])
    for item, holm in zip(raw, corrected, strict=True):
        lines.append(f"{item[0]},{item[1]},{item[2]},{item[3]:.4f},{item[4]:.4f},{item[5]:.6g},{item[6]:.6g},{holm:.6g}")
    if len(lines) == 1:
        lines.append("none,0,0,0,0,1,1,1")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _iqm(values: np.ndarray) -> float:
    sample = np.sort(values)
    if sample.size < 4:
        return float(sample.mean())
    drop = sample.size // 4
    return float(sample[drop: sample.size - drop].mean())


def _episodes_to_95(items: list[dict]) -> str:
    by_episode: dict[int, list[float]] = {}
    for item in items:
        by_episode.setdefault(int(item["episode"]), []).append(1.0 if item["success"] else 0.0)
    running: list[float] = []
    for episode in sorted(by_episode):
        running.append(float(np.mean(by_episode[episode])))
        if float(np.mean(running)) >= 0.95:
            return str(episode + 1)
    return ""


def _cohens_d(left: list[float], right: list[float]) -> float:
    a = np.array(left, dtype=float)
    b = np.array(right, dtype=float)
    pooled = np.sqrt(((a.size - 1) * a.var(ddof=1) + (b.size - 1) * b.var(ddof=1)) / max(a.size + b.size - 2, 1))
    if pooled == 0:
        return 0.0
    return float((a.mean() - b.mean()) / pooled)


def _welch_p(left: list[float], right: list[float]) -> float:
    a = np.array(left, dtype=float)
    b = np.array(right, dtype=float)
    if a.size < 2 or b.size < 2:
        return 1.0
    va = a.var(ddof=1)
    vb = b.var(ddof=1)
    se = np.sqrt(va / a.size + vb / b.size)
    if se == 0:
        return 1.0
    t_stat = abs(float((a.mean() - b.mean()) / se))
    # A normal tail is enough for the harness summary; small samples are conservative at 1.
    if a.size + b.size < 8:
        return 1.0
    # Two-sided normal approximation.
    return float(2 * (1 - _phi(t_stat)))


def _mannwhitney_p(left: list[float], right: list[float]) -> float:
    a = np.array(left, dtype=float)
    b = np.array(right, dtype=float)
    if a.size == 0 or b.size == 0 or a.size * b.size > 20000:
        return 1.0
    greater = 0
    ties = 0
    for left_value in a:
        for right_value in b:
            if left_value > right_value:
                greater += 1
            elif left_value == right_value:
                ties += 1
    statistic = greater + 0.5 * ties
    mean = a.size * b.size / 2
    variance = a.size * b.size * (a.size + b.size + 1) / 12
    if variance == 0:
        return 1.0
    z_stat = abs(statistic - mean) / np.sqrt(variance)
    return float(2 * (1 - _phi(float(z_stat))))


def _holm(p_values: list[float]) -> list[float]:
    if not p_values:
        return []
    order = np.argsort(p_values)
    adjusted = [1.0] * len(p_values)
    running = 0.0
    count = len(p_values)
    for rank, index in enumerate(order):
        corrected = min(1.0, (count - rank) * p_values[index])
        running = max(running, corrected)
        adjusted[index] = running
    return adjusted


def _phi(value: float) -> float:
    return 0.5 * (1.0 + _erf(value / np.sqrt(2.0)))


def _erf(value: float) -> float:
    import math
    return math.erf(value)


if __name__ == "__main__":
    main()
