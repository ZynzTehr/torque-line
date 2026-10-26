---
name: implement
description: "Implement a piece of work based on a spec or set of tickets, or coordinate a whole spec's ticket graph with subagents."
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/engineering/implement
  changes: modified
  status: stable
  reviewed: 2026-10-20
---

Implement the work described by the user in the spec or tickets.

For a whole spec whose tickets form a graph of blocking relationships, follow [ticket-graph.md](ticket-graph.md) to coordinate it with subagents on one integration branch. For a single ticket or a small spec, continue here.

When the ticket lives under `.scratch/<feature>/issues/`, claim it before changing code: set its Status to claimed with a Claimed by line, and state the current phase and the ticket in your first reply. Before completing, run the review the ticket's Verify tier requires (tier 2: one independent review with the code-review skill; tier 3: adversarial review and the user's sign-off). Complete it by ticking the acceptance boxes, setting Status done, appending the Done line (the check and its result, the review that ran, anything unverified) and committing the ticket file with the work as `Done NN: <title>`. An unrelated small fix needs no ticket and is never folded into a claimed one. In a workstream checkout, merge the integration branch before each claim, claim only your workstream's tickets, change only its owned paths, and write a Request for anything else. Never edit `PROGRESS.md`; it is generated from the ticket files. The rules are in [progress-operations.md](progress-operations.md).

Several independent sessions on one plan: the user invokes [workstreams](../workstreams/SKILL.md); it is never the default.

Read the applicable product/technology decisions and experience acceptance before changing code. For substantial UI work without an established direction, use [creative-direction](../creative-direction/SKILL.md). Preserve a chosen stack and visual identity; a small fix does not restart discovery.

Use /tdd where possible, at pre-agreed seams.

Discover and run the project's relevant checks under the [verification contract](../../rules/principles.md#verification-contract). Use its actual language and toolchain rather than assuming a particular typechecker or package manager.

For UI changes, exercise the affected flow and apply the [experience review](../creative-direction/SKILL.md#review-the-experience). Compare the assembled result with the brief and record measured results, visual judgments, and unavailable checks separately. Fix concrete failures within scope before completion.

Once done, use /code-review to review the work.

Commit your work to the current branch.
