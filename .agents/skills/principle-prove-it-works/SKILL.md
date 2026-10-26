---
name: principle-prove-it-works
description: Apply the verification contract to changed behavior and delegated artifacts before declaring the requested task complete.
license: MIT
metadata:
  source: https://github.com/cursor/plugins/tree/main/pstack/skills/principle-prove-it-works
  changes: modified
  status: stable
  reviewed: 2026-10-04
---

# Prove it works

Follow [the verification contract](../../rules/principles.md). Decide which observable result would distinguish success from a plausible-looking failure, then exercise that path on the actual artifact.

For a service, check the response and state it produced. For a process, check its actual liveness. For a delegated change, inspect the code and rerun the meaningful check instead of accepting its completion message. A build alone cannot prove runtime behavior.

Preserve a repeatable check when it helps a reviewer. Keep verification within the user's authorized resources and report missing access or unavailable tools precisely.
