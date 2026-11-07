# Benchmark results

Captured outputs from LOCOMO benchmark runs against agent-core memory providers.

## Provenance

[LOCOMO](https://github.com/snap-research/locomo) is a public benchmark for
evaluating very long-term conversational memory of LLM agents (Maharana et al.,
2024). The dataset of multi-session conversations and question/answer pairs is
fetched by the benchmark harness at run time — the dataset itself is not
committed here; only run artifacts are.

## Contents

- `locomo/` — a small LOCOMO run (5 questions) against the embedded mem0-style
  provider. `locomo_results_*.json` holds aggregate accuracy metrics by top-k
  cutoff; `predicted_*/` holds per-question predictions and ingestion records.
- `locomo-full/` — a full-dataset run. Only `_progress_*.json` ingestion
  checkpoints were produced before the run stopped.

`_progress_*.json` files are resumable-ingestion checkpoints written by the
harness, not results. This directory is gitignored going forward; run artifacts
are kept locally and should be treated as ephemeral.
