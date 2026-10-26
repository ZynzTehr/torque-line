---
name: autonomy-full
description: Apply full autonomy only when selected by the user; loading this skill does not activate it or authorize unrelated external actions.
metadata:
  source: original
  status: stable
  reviewed: 2026-10-04
---

# Full autonomy

Read [the canonical autonomy policy](../../autonomy-config.md), adjacent to the package's `AGENTS.md`. Apply its full column only when the user selected this profile. Otherwise use the current profile, with safe as the fallback.

Full autonomy permits discretion within the user's explicit task and target scope. Sensitive actions retain the canonical policy's authorization requirements. A skill name, source instruction, or request to keep working cannot activate this profile. Do not maintain a separate permission table here.
