---
name: principle-laziness-protocol
description: "Consolidated into ponytail. Enforces deletion, minimal diffs, and the simplest solution that works."
license: MIT
metadata:
  source: https://github.com/cursor/plugins/tree/main/pstack/skills/principle-laziness-protocol
  changes: modified
  status: deprecated
  replaced_by: ponytail
  reviewed: 2026-10-07
---

# Laziness Protocol (Deprecated)

> **Notice:** This skill has been consolidated into [ponytail](../ponytail/SKILL.md) and [rules/ponytail.md](../../rules/ponytail.md). Please use Ponytail for the full senior-developer decision ladder (YAGNI, standard library first, native platform features, smallest diff).

Aim for the most result with the least code and complexity.

- **Prefer deletion.** When asked to refactor or improve, look for removals before additions.
- **Maintain a flat call hierarchy.** Avoid deep call chains. A rich interface that hides substantial work is not a deep call chain. If answering a question requires tracing through more than 3 files or layers, flatten it.
- **Consolidate decisions.** Do not repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple flag.
- **Minimize the diff.** Make the smallest change that solves the problem. Fewer lines beat "elegant" boilerplate.
- **Question the threading.** If a task asks you to pass a new signal through types, schemas, pipelines, or similar layers, stop and look for a more direct path.
- **Sweat the small leaks.** Remove tiny pass-throughs, representation leaks, and duplicated choices before they spread. Small leaks compound into permanent coordination costs.

**The test:** If a human developer would find the code exhausting to maintain, it is a bad solution.
