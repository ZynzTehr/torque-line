# Progress operations

How a session records where a planned project stands, so the generated board and every later session can read it without asking. These rules apply once a project has tickets under `.scratch/<slug>/issues/`; a project without them is untouched. In an installed project this file is `.agents/skills/implement/progress-operations.md`, and the session start note points at it; in the package source it is `skills/implement/progress-operations.md`.

<!-- reference-contents:start -->
## Contents

- [Vocabulary](#vocabulary)
- [Fields](#fields)
- [Phases and gates](#phases-and-gates)
- [Frontier](#frontier)
- [When to claim](#when-to-claim)
- [Report](#report)
- [Claim](#claim)
- [Complete](#complete)
- [Pause](#pause)
- [Release](#release)
- [Request](#request)
- [One writer per ticket file](#one-writer-per-ticket-file)
- [Verification tiers](#verification-tiers)
- [Board](#board)
- [Tracked files](#tracked-files)
<!-- reference-contents:end -->

## Vocabulary

- Plan of record: `.scratch/<slug>/spec.md` (optional `## Phases` section) plus one ticket per file at `.scratch/<slug>/issues/NN-<slug>.md`, where NN is 2 or 3 digits. Parallel mode adds `.scratch/<slug>/workstreams.md`. A plan folder that also holds `map.md` is a wayfinder effort and gets one line on the board.
- Board: `PROGRESS.md` at the project root, generated from the plan of record, gitignored, marker-stamped, never edited by hand.
- Status vocabulary: open = ready-for-agent, ready-for-human, needs-triage, needs-info (the triage labels); claimed = in progress; terminal = done, resolved, wontfix. "blocked" is never written: it is derived from Blocked by edges.
- Current phase: the lowest phase with a non-terminal ticket.
- Frontier: the open, unblocked, unclaimed, ready-for-agent tickets in any phase.
- Gate: the ticket titled "Phase N review" that ends phase N.
- Plan phases are not ask-matt's session phases. A plan phase is a group of tickets behind an exit criterion. A session phase ([PHASE-BOUNDARIES.md](../ask-matt/PHASE-BOUNDARIES.md)) is a context-management boundary inside one session.

## Fields

Fields sit near the top of the ticket file, within its first 40 lines, in the `**Field:** value` form; plain `Field: value` is also accepted.

- `**Status:**` one of the status words above. A missing line means open.
- `**Blocked by:**` ticket numbers separated by commas, or None. Numbers only: a line with text but no numbers is the error unparsed-blockers and counts as blocked. A blocker releases its dependents only when it is done or resolved; wontfix keeps them blocked.
- `**Phase:** N` (default 1).
- `**Verify:** 1|2|3` (default 1); see Verification tiers.
- `**Workstream:** <name>` (parallel mode only); "integrator" on gate tickets and any ticket the integrator owns.
- `**Claimed by:** <who>, <YYYY-MM-DD>`, where who is `<harness>@<host>` in single mode (example `claude@mbp`) and `<workstream> (<harness>@<host>)` in parallel mode (example `backend (codex@mbp)`). A missing line is allowed and shows as unknown.

Comments lines are appended under `## Comments` as list items, one per event, in order:

- `- Done <date>: <check command and result>; review: <none, or skill and model>; unverified: <list, or none>`
- `- Paused <date>: <resume point>`
- `- Released <date>: <why>`
- `- Request <date>: <need>` (parallel mode: a change to a shared path or a new ticket, applied by the integrator)

Error codes the generator reports: unknown-status, unknown-blocker, unparsed-blockers, blocked-by-cycle, unknown-workstream, misclaim (Claimed by names a different workstream than the Workstream line), duplicate-number, unreadable, missing-title, bad-phase, bad-verify. The Stop hook blocks once on a malformed ticket this checkout may write; fix the Status, Blocked by, Phase, or Workstream line it names.

A complete ticket file:

```markdown
# 04: Confirm a booking by email

**What to build:** a guest who completes checkout receives a confirmation email with the booking reference, and the booking shows as confirmed in the host's list.

**Blocked by:** 02, 03

**Status:** claimed

**Phase:** 2

**Verify:** 2

**Claimed by:** claude@mbp, 2026-10-20

**Decision references:** .scratch/booking/spec.md, Implementation Decisions (email provider).

- [x] Checkout sends one confirmation email carrying the booking reference
- [ ] The host list shows the booking as confirmed after one refresh

## Comments

- Paused 2026-10-20: the email path works; next is the status column in src/host/list.ts.
```

## Phases and gates

`## Phases` in spec.md holds one line per phase, shaped `N. <Name>. <Goal>. Exit: <observable criterion>.` A complete block:

```markdown
## Phases

1. Contract. Freeze the booking API and the data model so later tickets can run against fixtures. Exit: the contract tests in tests/contract pass against the stub server.
2. Booking flow. A guest can search, book and receive a confirmation. Exit: the end-to-end booking test passes and the product owner has walked through the flow on staging.
```

Each phase ends with a gate ticket titled "Phase N review", blocked by the phase's other tickets. Its acceptance is the Exit criterion, its tier is Verify 3, and it is ready-for-agent unless the Exit names a person; then it is ready-for-human and the user closes it. A phase is complete when all of its tickets, the gate included, are terminal.

## Frontier

The frontier is every ticket that is open, unblocked, unclaimed and ready-for-agent, in any phase. A later-phase ticket whose blockers are done is on it, so a solo session is never stalled by a gate that waits for a person. Take the lowest number unless the user names a ticket. Do not spread parallel work across phases: subagents and workstreams work one phase's frontier at a time.

## When to claim

Claim only when the user's request is one of the plan's tickets, and claim before changing code. An unrelated small fix needs no ticket and is never folded into a claimed one: make it on its own, commit it on its own, and leave the plan files alone.

## Report

State the current phase and the ticket in your first reply, for example "Phase 2 of 3, Booking flow; claiming 04, Confirm a booking by email." The session start note carries the numbers; PROGRESS.md and the ticket file carry the text, so read them before answering.

## Claim

Set `**Status:** claimed` and the Claimed by line, then save. In single mode the saved file is the claim; no commit is needed. In parallel mode commit the ticket file as `Claim NN: <title>` on the workstream branch and push only when this conversation authorized pushes. A rejected push means a second writer exists: keep the local commit, report both heads, and wait; never fetch-merge-retry, reset or force.

## Complete

Tick the acceptance boxes, set `**Status:** done`, append the Done comment line, and commit the ticket file with the work as `Done NN: <title>`. The Done line is the evidence the board shows: the check command and its result, the review (none, or the skill and the model), and what stayed unverified, for example `- Done 2026-10-21: npm test, 42 passed; review: code-review on sonnet; unverified: none`. Resolved and wontfix are terminal too; a wontfix blocker keeps its dependents blocked and appears under Needs attention.

## Pause

When work stops before completion, append `- Paused <date>: <resume point>` and keep the claim. When code changed while a claim stayed open without this line, the Stop hook warns the user, and the next session start note names the claim, so add the line before you stop. After compaction, re-read PROGRESS.md and the ticket file.

## Release

To hand a ticket back, set Status to ready-for-agent, remove the Claimed by line, and append `- Released <date>: <why>`. In parallel mode commit it on the workstream branch; a dead session's ticket is released on its own branch first, then reassigned by the integrator. That release is the one exception to the single-writer rule: after the user declares the session dead, the integrator makes exactly one Release commit on that branch.

## Request

Parallel mode only. A change to a shared path or a new ticket is a Request: append `- Request <date>: <need>` to the ticket that needs it and carry on with what you own. The integrator applies it on the integration branch and records the outcome under `## Integrator notes` in workstreams.md. Only the integrator creates ticket files in parallel mode, so numbers stay unique.

## One writer per ticket file

Exactly one writer edits a ticket file: the session in single mode; the owning workstream on its own branch in parallel mode; the coordinator in ticket-graph mode, where implementer and merger subagents never edit ticket files. The integrator writes only workstreams.md's `## Integrator notes` and integrator-owned tickets, on the integration branch; its one exception is the Release commit on a branch whose session the user declared dead. A missing Claimed by line is allowed; a second writer is not.

## Verification tiers

The Verify line scales rigor to blast radius. to-tickets sets it, the Done line records the evidence, and the board shows the tier beside each done ticket.

| Tier | When | Done means |
|---|---|---|
| 1 | Mechanical or reversible | The named check passes; whoever merges reruns it |
| 2 | Behavior change | Tier 1 plus one independent review with the code-review skill, on a different model when a model policy names one |
| 3 | Phase gate, security change or one-way door | Tier 2 plus adversarial multi-model review with the interrogate skill when available, and the user's sign-off |

Nothing is re-reviewed without a change. Record evidence, not confidence: the check that ran, the commit, a screenshot, or an honest "unverified".

## Board

`python3 -B .agents/scripts/progress.py --write` regenerates PROGRESS.md (in the package source: `python3 -B scripts/progress.py --write`). The hooks run it at session start, before compaction, and at every stop while a plan exists; run it by hand when you need a fresh view before the next stop, for example after a fetch, or when no hook runs. The board shows the current phase, tickets in progress and by whom, ready to claim (the frontier), blocked, done with verification tier and evidence, needs attention, requests, integrator notes, workstreams, how to resume, and errors. A completed plan is one line under "Other plans"; when no plan remains the marker-stamped board is removed. Never edit PROGRESS.md: change the ticket files and rerun the generator. The installer adds `/PROGRESS.md` to .gitignore, and the generator refuses to write a board that git would track; a folder without a git checkout is written freely.

## Tracked files

The spec, the ticket files and workstreams.md are tracked in git; the board is per checkout and never committed. A commit is the only way status crosses sessions, worktrees and machines: a saved claim reaches the next session in the same checkout, and the `Done NN` commit carries the result everywhere else.

Several independent sessions on one plan use the workstreams skill ([skills/workstreams/SKILL.md](../workstreams/SKILL.md)); it is never the default.
