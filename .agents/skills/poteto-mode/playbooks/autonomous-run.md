### Autonomous run

**You own the exit condition. Define done, then drive to it without stopping.**

Apply [the autonomy policy](../../../autonomy-config.md) and [HARNESS.md](../../../HARNESS.md). Continuation stays within the user's task, budget, and current permissions; propagate a user pause or stop immediately.

1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero).
2. Use the harness's supported event watch or scheduling mechanism when the authorized task needs waiting. Cursor's `/loop` is one option when available. Without background continuation, work synchronously and leave a checkpoint at the session boundary; do not imply that an inactive agent will wake itself.
3. Each iteration makes the smallest change the evidence justifies, verifies it against the predicate, commits if it advanced, discards changes that didn't help. Belt-and-suspenders that "might help" gets reverted, not left to ride.
   Sequence the work via the **sequence-verifiable-units** principle skill, verifying each unit before the next instead of batching checks at the end.
4. Fix discovered blockers necessary to complete the requested task, within its authorized scope. Record unrelated problems separately; ask before expanding scope. Do not rewrite policy, loosen checks, publish additional PRs, or change credentials merely to keep the run moving. Ask for missing product decisions or authorization while continuing independent authorized work.
5. Checkpoint every iteration via the **show-me-your-work** skill, a row for what changed and whether the predicate moved.
6. Stop when the predicate is met. A plateau is not a stop, so keep going and pivot your approach to push past it. Surface a genuine dead end rather than spinning, and never relax the predicate to declare victory.

**Reply:** the exit condition, iterations run, what landed, what was discarded, final predicate state.
