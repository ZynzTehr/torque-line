---
name: no-comments
description: Review comments in a scoped diff, remove redundant prose, and preserve documented constraints. Use for comment cleanup or the comment review before a PR.
license: MIT
metadata:
  source: https://github.com/cursor/plugins/tree/main/pstack/skills/no-comments
  changes: modified
  status: stable
  reviewed: 2026-10-04
---

# Comment review

Use the caller's files or diff. Otherwise inspect the current task's diff against its known base, including related working-tree changes. Identify the base from the repository; do not assume `main` or include unrelated user edits. Review-only requests produce findings without edits.

1. Read each comment with the code it describes. Flag comments that merely repeat the code, stale claims, and commented-out code. Keep explanations of non-obvious intent, public API documentation, licensing, and constraints the code does not express.
2. Review locally with native file and diff tools. If an appropriate comment reviewer is available, delegation is optional; pass the same scope and validate its findings yourself. `Comment Sicko` is not required. Use [HARNESS.md](../../HARNESS.md) for tool fallbacks.
3. Trace a proposed deletion to the behavior it describes. Uncertainty is a reason to preserve the comment and report the unresolved question. Inspect suppressions and workarounds for correctness rather than deleting them for style. A comment cleanup does not authorize removing code or redesigning an API.
4. Make only accepted, authorized changes within scope. Apply [the canonical autonomy policy](../../autonomy-config.md) when a comment records a protected constraint or a change needs additional authorization. Verify any approved replacement enforcement before removing the constraint comment. Preserve the comment if the replacement does not demonstrably enforce it.
5. Inspect the final diff and run checks appropriate to any executable or tooling changes. Report the edits, verification, and comments retained because their intent or enforcement remains unresolved.
