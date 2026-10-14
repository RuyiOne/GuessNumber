"""Train one configuration, or a named section of the experiment plan."""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np

from .agents import QAgent
from .env import NumeroEnv
from .plan import iter_runs, load_plan


def train_run(spec: dict, out_dir: Path, save_weights: bool = True) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    cumulative = 0.0
    env = NumeroEnv(
        ruleset=spec["ruleset"],
        reward_mode=spec["reward"],
        number_change=spec["number_change"],
        notify_on_change=spec["notify_on_change"],
        max_guesses=spec["max_guesses"],
        configuration=spec["configuration"],
        seed=spec["seed"],
    )
    rng = np.random.default_rng(spec["seed"])
    agent = None
    if spec["agent"] not in ("random", "swor"):
        agent = QAgent(spec, env.observation_size, env.action_size, rng)

    for episode in range(spec["episodes"]):
        started = time.perf_counter()
        observation, info = env.reset(seed=spec["seed"] + episode * 1009)
        legal = info["legal"]
        total = 0.0
        solved = False
        metrics = {"loss": 0.0, "td_error": 0.0, "priority": 0.0, "is_weight": 0.0, "stale_fraction": 0.0}
        updates = 0
        done = False
        while not done:
            action = _select(spec["agent"], observation, legal, env, rng, agent)
            previous = observation
            previous_legal = legal
            observation, reward, terminated, truncated, info = env.step(action)
            done = terminated or truncated
            solved = solved or bool(info.get("solved"))
            total += reward
            legal = info["legal"]
            if agent is not None and not info.get("illegal"):
                if info.get("changed"):
                    agent.note_change()
                update = agent.push(previous, action, reward, observation, terminated, previous_legal, legal)
                if update:
                    metrics = update
                    updates += 1
        if agent is not None:
            agent.end_episode((episode + 1) / spec["episodes"])
        elapsed = max(time.perf_counter() - started, 1e-9)
        cumulative += total
        rows.append(
            {
                "episode": episode,
                "seed": spec["seed"],
                "agent": spec["agent"],
                "per": spec["per"],
                "configuration": spec["configuration"],
                "ruleset": spec["ruleset"],
                "reward_mode": spec["reward"],
                "number_change": spec["number_change"],
                "notify_on_change": spec["notify_on_change"],
                "episode_reward": total,
                "success": solved,
                "cumulative_reward": cumulative,
                "guesses": env.guesses,
                "loss": metrics["loss"],
                "td_error": metrics["td_error"],
                "priority": metrics["priority"],
                "is_weight": metrics["is_weight"],
                "epsilon": 0.0 if agent is None else agent.epsilon,
                "stale_fraction": metrics["stale_fraction"],
                "wall_seconds": elapsed,
                "steps_per_second": env.guesses / elapsed,
                "updates": updates,
            }
        )

    path = out_dir / _filename(spec)
    _write_table(path, rows)
    if agent is not None and save_weights:
        _save_weights(out_dir / _filename(spec).with_suffix(".npz"), agent)
    return path


def _select(name: str, observation, legal, env: NumeroEnv, rng, agent: QAgent | None) -> int:
    if name == "random":
        return int(rng.integers(env.action_size))
    if name == "swor":
        legal_index = np.flatnonzero(legal)
        if legal_index.size == 0:
            return int(rng.integers(env.action_size))
        return int(rng.choice(legal_index))
    assert agent is not None
    return agent.act(observation, legal)


def _filename(spec: dict) -> Path:
    per = "per" if spec["per"] else "uniform"
    notify = "notify" if spec["notify_on_change"] else "silent"
    name = (
        f"{spec['configuration']}_{spec['agent']}_{per}_{spec['ruleset']}_{spec['reward']}"
        f"_{spec['number_change']}_{notify}_seed{spec['seed']}.parquet"
    )
    return Path(name)


def _write_table(path: Path, rows: list[dict]) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    table = pa.Table.from_pylist(rows)
    pq.write_table(table, path)


def _save_weights(path: Path, agent: QAgent) -> None:
    arrays = {f"w{index}": parameter for index, parameter in enumerate(agent.online.parameters())}
    np.savez(path, **arrays)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Train one section of the Numero experiment plan.")
    parser.add_argument("--plan", default="experiments/paper.yaml")
    parser.add_argument("--section", default="smoke", choices=["smoke", "table1_r0", "primary", "ablation", "sensitivity", "references"])
    parser.add_argument("--out", default="runs")
    parser.add_argument("--limit", type=int, default=0, help="Stop after this many runs. 0 means the whole section.")
    parser.add_argument("--full", action="store_true", help="Run every run in the section.")
    parser.add_argument("--no-weights", action="store_true", help="Keep the episode logs and skip the weight files.")
    args = parser.parse_args(argv)
    plan = load_plan(Path(args.plan))
    runs = list(iter_runs(plan, args.section))
    if args.limit:
        runs = runs[: args.limit]
    if args.section != "smoke" and args.limit == 0 and not args.full:
        raise SystemExit(
            f"Section '{args.section}' contains {len(runs)} runs. "
            "Pass --limit to run the first few, or --full to run the section."
        )
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for index, spec in enumerate(runs, start=1):
        destination = out / _filename(spec)
        label = f"[{index}/{len(runs)}] {spec['agent']} per={spec['per']} seed={spec['seed']} {spec['ruleset']} {spec['reward']} change={spec['number_change']}"
        if destination.exists():
            print(f"{label} already logged", flush=True)
            continue
        print(label, flush=True)
        train_run(spec, out, save_weights=not args.no_weights)


if __name__ == "__main__":
    main()
