# Paper metrics

Drop the published paper’s metric files in this folder: tables, figures, and raw results (CSV, Parquet, PNG, PDF, or LaTeX).

The experiment harness is not built yet. When it is, training logs will be written to `rl/runs/`, and `python -m gn_rl.report runs/ --out paper_figs/` will write the figures and LaTeX tables to `rl/paper_figs/`.
