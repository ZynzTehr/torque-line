# Starting a skill

Use this only when a new skill or structural rewrite needs a template. Adapt the headings to the actual task; replace every placeholder before delivery. A simple skill needs no extra directories.

````markdown
---
name: task-name
description: Perform the specific task when the user requests its outcome; state a useful exclusion if a nearby workflow overlaps.
metadata:
  source: original
  status: experimental
  reviewed: YYYY-MM-DD
---

# Task outcome

State the deliverable and the non-obvious constraint that makes this guidance useful.

## Workflow

1. Inspect the minimum inputs needed to choose an approach.
2. Perform the requested work, preserving the named invariants.
3. Verify the observable result with the appropriate check.
4. Stop when the acceptance condition is met; report remaining limitations.

## Conditional details

For the named optional mode, read [mode.md](references/mode.md).
Delete this section if no reference is needed; never leave a broken link.

## Evidence

Return the artifact location, checks performed, and any unresolved issue.
````

For example, a fixture-normalization skill might accept a JSON fixture path, preserve its values and array order, sort object keys, and verify semantic equality after formatting. The skill should not trigger for a request to change business logic. Add a deterministic formatter only when it will be reused or makes correctness easier to verify.

Choose one realistic request and its expected observable result before writing a long checklist. If shortening an existing skill, keep a small list of capabilities and constraints that must survive, then check them against the rewrite.
