---
trigger: model_decision
description: "Apply when diagnosing or fixing a bug, failing check, crash, unexpected behavior, or regression."
---

# Debugging

## Reproduce first

Before changing any code, reproduce the failure. A bug you cannot reproduce is a bug you cannot verify you fixed.

- Get the exact error message, stack trace, or observable symptom.
- Identify the smallest set of inputs or steps that triggers it.
- If you cannot reproduce locally, say so and explain what you tried.

## Trace to the root cause

Do not fix symptoms. Each workaround makes the system harder to reason about, and the real bug remains.

- Ask "why" until you hit the root cause. The first answer is almost never the root cause.
- Do not add guards that silence crashes (nil checks, try/catch swallowing, fallback defaults) unless the guard itself is the correct fix. If a workaround needs a paragraph-long comment to justify it, the code is wrong.
- Check for the pattern, not just the instance. Search for the same mistake elsewhere and report related instances; fix them when they are part of the requested failure or the user agrees.

## Instrument, do not guess

When stuck, add observability. Do not hypothesize about what the code might be doing.

- Add logging at the boundaries: what went in, what came out, what failed.
- Read the actual error. The full message, the full stack trace. Not a summary or memory of what it said last time.
- Check actual state: file contents, database rows, network responses, environment variables. Not cached assumptions about what they should be.

## Suspect state before code

When something fails after a restart, deploy, or environment change, suspect stale persistent state first.

- Config files, caches, lock files, serialized state, stale environment variables.
- If clearing a state file restores behavior, the fix is state validation, not a code patch.
- Check for version mismatches between running processes and deployed code.

## Verify the fix

After fixing:
1. Rerun the original reproduction steps. Confirm the symptom is gone.
2. Run adjacent tests to catch collateral damage.
3. **Regression-first** — When the bug has a clear, cheap test path: write the failing test *before* fixing. Run it, confirm it fails for the expected reason. Fix the code. Rerun, confirm it passes. When a failing test is impractical (broad harness, brittle mocks, production-only state), say why and use the closest executable check instead.
4. Report the evidence: what failed, what you changed, what proof you have that it works now.

## Performance regressions

- Profile before optimizing. Do not guess at the bottleneck.
- Measure with representative data, not toy inputs.
- Compare before and after with the same measurement. Wall-clock time, memory, request count. Whatever matches the symptom.
- One change at a time. Measure after each. Multiple simultaneous "optimizations" make attribution impossible.
