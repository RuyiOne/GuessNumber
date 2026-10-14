from pathlib import Path

from gn_rl.plan import count_runs, load_plan
from gn_rl.report import main as report_main
from gn_rl.train import train_run

PLAN = Path(__file__).resolve().parents[1] / "experiments" / "paper.yaml"


def test_plan_counts_the_paper_and_the_new_variants():
    counts = count_runs(load_plan(PLAN))
    assert counts["smoke"] == 1
    assert counts["table1_r0"] == 20
    # 4 agents × PER on/off × 3 boards × 2 rewards × (change off, change on silent, change on notified) × 10 seeds
    assert counts["primary"] == 4 * 2 * 3 * 2 * 3 * 10
    assert counts["references"] == 2 * 3 * 2 * 10
    assert counts["ablation"] == (4 + 3 + 2) * 10
    assert counts["sensitivity"] == 30


def test_smoke_run_writes_a_log_and_a_report(tmp_path: Path):
    plan = load_plan(PLAN)
    from gn_rl.plan import iter_runs

    spec = next(iter_runs(plan, "smoke"))
    log = train_run(spec, tmp_path)
    assert log.exists()
    assert log.stat().st_size > 0
    report_main([str(tmp_path), "--out", str(tmp_path / "figs")])
    assert (tmp_path / "figs" / "summary.csv").exists()
    assert (tmp_path / "figs" / "learning_curves.png").exists()
    summary = (tmp_path / "figs" / "summary.csv").read_text(encoding="utf-8")
    assert "r1/dqn/uniform/classic4/shaped" in summary
