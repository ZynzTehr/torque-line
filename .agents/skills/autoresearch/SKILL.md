---
name: autoresearch
description: Autonomous research and experimentation loop for code optimization and machine learning experiments. Autonomously formulates hypotheses, edits code, runs time-budgeted trials, evaluates metrics against a baseline, keeps improvements, reverts regressions, and logs to results.tsv. Use for /autoresearch, "autoresearch", "autonomous experiment loop", "run experiments overnight", "hyperparameter search".
license: MIT
metadata:
  source: original
  status: stable
  reviewed: 2026-10-07
---

# Autoresearch

An autonomous research and code optimization experiment loop inspired by Karpathy's autoresearch. The agent formulates hypotheses, implements modifications, executes fixed-budget benchmark runs, evaluates metric changes, and autonomously advances or reverts git state without human interruption.

## The experiment loop

```
+-----------------------------------------------------------+
| 1. Formulate Hypothesis & Edit Target File                |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| 2. Commit Change to Experiment Branch                     |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| 3. Run Benchmark Run (e.g. 5-min wall-clock budget)       |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
| 4. Extract Metrics (grep output from run.log)             |
+-----------------------------+-----------------------------+
                              |
            +-----------------+-----------------+
            |                                   |
            v Metric Improves                   v Metric Degrades or Crashes
+-----------------------+           +-----------------------+
| 5a. Status: keep      |           | 5b. Status: discard   |
| Advance git branch    |           | git reset --hard HEAD~|
+-----------+-----------+           +-----------+-----------+
            |                                   |
            +-----------------+-----------------+
                              |
                              v
+-----------------------------------------------------------+
| 6. Log Row to results.tsv (commit, metric, status, desc)  |
+-----------------------------+-----------------------------+
                              |
                              v
                     Repeat Autonomously
```

## Setup procedure

1. **Establish a dedicated experiment branch:** Create a clean branch from main/master (e.g. `git checkout -b autoresearch/experiment-tag`).
2. **Define strict file boundaries:**
   - **Editable code:** The specific algorithm or training file being optimized (e.g. `train.py`).
   - **Read-only harness:** Fixed benchmark evaluation, data loader, tokenizer, and ground-truth metrics (e.g. `prepare.py`). Never modify the evaluation metric.
3. **Establish baseline:** Execute the first trial with unchanged code to record the ground-truth baseline metric.
4. **Initialize results log:** Create `results.tsv` (tab-separated columns: `commit`, `metric`, `memory_gb`, `status`, `description`). Keep `results.tsv` untracked by git.

## Execution protocol

1. **Autonomous continuation:** Do not pause to ask the user if you should continue. The loop is designed to run unattended overnight.
2. **Fixed time budget:** Each experiment must run within a strict timeout (e.g. 5 minutes). If a run times out or hangs, kill the process, record status as `crash` or `discard`, and revert.
3. **Log redirection:** Always redirect command stdout and stderr to a log file (`> run.log 2>&1`). Never flood terminal context with epoch-by-epoch training output.
4. **Simplicity win criterion:** A small metric improvement that introduces excessive, hacky complexity is not worth keeping. An equal metric result with deleted or simplified code is a win and should be kept.
