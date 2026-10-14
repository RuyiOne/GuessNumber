"""Train from a YAML file: python -m gn_rl experiments/smoke.yaml"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from gn_rl.train import load_config, run_config


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Train Numero agents from an experiment file.")
    parser.add_argument("config", type=Path)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    config = load_config(args.config)
    written = run_config(config, args.root)
    for path in written:
        print(path)


if __name__ == "__main__":
    main(sys.argv[1:])
