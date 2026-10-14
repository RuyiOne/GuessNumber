"""Run every section of the paper plan, in order. Existing logs are left in place."""

from gn_rl.train import main

SECTIONS = ("table1_r0", "references", "primary", "ablation", "sensitivity")

if __name__ == "__main__":
    for section in SECTIONS:
        print(f"\n=== {section} ===", flush=True)
        main(["--plan", "experiments/paper.yaml", "--section", section, "--full", "--no-weights", "--out", "runs"])
