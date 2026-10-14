"""Expand the paper plan into concrete training runs."""

from __future__ import annotations

from pathlib import Path

import yaml


def load_plan(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def iter_runs(plan: dict, section: str):
    if section == "smoke":
        yield _spec(plan, plan["smoke"])
        return
    if section == "table1_r0":
        yield from _table1(plan)
        return
    if section == "primary":
        yield from _primary(plan)
        return
    if section == "references":
        yield from _references(plan)
        return
    if section == "ablation":
        yield from _ablation(plan)
        return
    if section == "sensitivity":
        yield from _sensitivity(plan)
        return
    raise ValueError(f"Unknown section '{section}'.")


def count_runs(plan: dict) -> dict[str, int]:
    return {section: sum(1 for _ in iter_runs(plan, section)) for section in
            ("smoke", "table1_r0", "primary", "references", "ablation", "sensitivity")}


def _base(plan: dict, per: bool, configuration: str) -> dict:
    shared = plan["shared"]
    table = plan["table1"]
    if configuration == "r0":
        learning_rate = table["learning_rate_per"] if per else table["learning_rate"]
        batch_size = table["batch_size_per"] if per else table["batch_size"]
    else:
        # One shared set for the variants that were not in the published paper.
        learning_rate = shared["learning_rate"]
        batch_size = shared["batch_size"]
    return {
        "learning_rate": learning_rate,
        "batch_size": batch_size,
        "gamma": table["gamma"],
        "epsilon_start": table["epsilon_start"],
        "epsilon_end": table["epsilon_end"],
        "epsilon_decay": table["epsilon_decay"],
        "buffer_size": table["buffer_size"],
        "alpha": table["alpha"],
        "beta": table["beta"],
        "hidden": shared["hidden"],
        "target_interval": shared["target_interval"],
        "max_guesses": shared["max_guesses"],
        "per": per,
        "configuration": configuration,
    }


def _spec(plan: dict, raw: dict) -> dict:
    per = bool(raw["per"])
    configuration = raw["configuration"]
    spec = _base(plan, per, configuration)
    spec.update(raw)
    spec["per"] = per
    spec["notify_on_change"] = bool(raw.get("notify_on_change", False))
    change = raw.get("number_change", "off")
    spec["number_change"] = "off" if change in (False, "off", "no") else "on"
    return spec


def _table1(plan: dict):
    block = plan["table1_r0"]
    for per in (False, True):
        for seed in plan["seeds"]:
            yield _spec(plan, {
                "agent": "dqn",
                "per": per,
                "configuration": "r0",
                "ruleset": "classic4",
                "reward": "shaped",
                "number_change": "off",
                "notify_on_change": False,
                "seed": seed,
                "episodes": block["episodes"],
            })


def _primary(plan: dict):
    block = plan["primary"]
    for agent in block["agents"]:
        for per in (False, True):
            for ruleset in block["rulesets"]:
                for reward in block["rewards"]:
                    for number_change in ("off", "on"):
                        notifies = (False,) if number_change == "off" else (False, True)
                        for notify in notifies:
                            for seed in plan["seeds"]:
                                yield _spec(plan, {
                                    "agent": agent,
                                    "per": per,
                                    "configuration": "r1",
                                    "ruleset": ruleset,
                                    "reward": reward,
                                    "number_change": number_change,
                                    "notify_on_change": notify,
                                    "seed": seed,
                                    "episodes": block["episodes"],
                                })


def _references(plan: dict):
    block = plan["references"]
    for agent in ("random", "swor"):
        for ruleset in block["rulesets"]:
            for reward in block["rewards"]:
                for seed in plan["seeds"]:
                    yield _spec(plan, {
                        "agent": agent,
                        "per": False,
                        "configuration": "r1",
                        "ruleset": ruleset,
                        "reward": reward,
                        "number_change": "off",
                        "notify_on_change": False,
                        "seed": seed,
                        "episodes": block["episodes"],
                    })


def _ablation(plan: dict):
    block = plan["ablation"]
    episodes = block["episodes"]
    for seed in plan["seeds"]:
        for alpha in block["alpha"]:
            yield _labelled(plan, seed, episodes, alpha=alpha, tag="alpha")
        for beta in block["beta"]:
            yield _labelled(plan, seed, episodes, beta=beta, tag="beta")
        for buffer_size in block["buffer_size"]:
            yield _labelled(plan, seed, episodes, buffer_size=buffer_size, tag="buffer")


def _labelled(plan: dict, seed: int, episodes: int, tag: str, **overrides) -> dict:
    spec = _spec(plan, {
        "agent": "dqn",
        "per": True,
        "configuration": "r1",
        "ruleset": "classic4",
        "reward": "shaped",
        "number_change": "off",
        "notify_on_change": False,
        "seed": seed,
        "episodes": episodes,
    })
    spec.update(overrides)
    spec["ablation"] = tag
    return spec


def _sensitivity(plan: dict):
    block = plan["sensitivity"]
    rng_seed = 2026
    import numpy as np
    rng = np.random.default_rng(rng_seed)
    seeds = block["seeds"]
    for trial in range(block["trials"]):
        learning_rate = float(10 ** rng.uniform(-4, -2))
        epsilon_decay = float(rng.uniform(0.99, 0.999))
        spec = _spec(plan, {
            "agent": "dqn",
            "per": False,
            "configuration": "r1",
            "ruleset": "classic4",
            "reward": "shaped",
            "number_change": "off",
            "notify_on_change": False,
            "seed": seeds[trial % len(seeds)],
            "episodes": block["episodes"],
        })
        spec["learning_rate"] = learning_rate
        spec["epsilon_decay"] = epsilon_decay
        spec["trial"] = trial
        yield spec


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Print how many runs each section of the plan contains.")
    parser.add_argument("--plan", default="experiments/paper.yaml")
    args = parser.parse_args()
    plan = load_plan(Path(args.plan))
    for section, count in count_runs(plan).items():
        print(f"{section}: {count} runs")


if __name__ == "__main__":
    main()
