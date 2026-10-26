---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/engineering/to-tickets
  changes: modified
  status: stable
  reviewed: 2026-10-20
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

Use the project's established tracker and triage vocabulary when relevant. A request for tickets in chat or local files does not require tracker setup. Follow [HARNESS.md](../../HARNESS.md) for unavailable integrations and the canonical autonomy policy before external publication.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

For UI work, locate the spec's experience acceptance and chosen brief. Carry the relevant decisions and evidence expectations into each UI ticket. Keep a link to the shared brief rather than copying it into competing versions. Preserve the selected stack and agreed alternatives.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first
- A UI slice includes its affected interaction states and experience acceptance. For a multi-part UI, include an assembled-flow review after its contributing slices so individually correct components still form the intended experience.

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

Give each ticket a `**Phase:**` line when the spec has a `## Phases` section (the default is 1). Each phase ends with a gate ticket titled `Phase N review`, blocked by the phase's other tickets. Its acceptance is the phase's Exit criterion, its Verify tier is 3, and it is `ready-for-agent` unless the Exit names a person, in which case it is `ready-for-human` and that person closes it.

Give each ticket a `**Verify:**` tier: 1 for a mechanical or reversible change (the named check passes), 2 for a behavior change (tier 1 plus one independent review), 3 for a phase gate, a security change or a one-way door (tier 2 plus adversarial review and the user's sign-off). [progress-operations.md](../implement/progress-operations.md#verification-tiers) defines the tiers.

When `.scratch/<feature-slug>/workstreams.md` exists the plan runs in parallel mode: only the integrator creates ticket files, and each ticket carries a `**Workstream:**` line naming its owner (`integrator` on gate tickets). Partition by owned paths. With layer workstreams (backend, frontend, security) a ticket is vertical within its workstream's owned paths against the phase-1 frozen contract, so the frontend is demoable against contract fixtures or stubs and the backend is verifiable through contract tests, and the phase gate is the assembled-flow review. Otherwise partition by feature area and keep tickets fully vertical. A security workstream owns its own paths (such as `auth/`, `middleware/`, `tests/security/`) and writes Requests for changes elsewhere; wide refactors stay single-session.

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Review the breakdown

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Check that the slices are understandable, the blocking edges represent actual dependencies, and the scope matches the agreed plan. Recommend a grouping based on the work. Ask about consequential unresolved product decisions or an explicitly requested checkpoint; do not require repeated approval for an already settled breakdown. Deliver planning-only requests in the requested form.

### 5. Publish the tickets to the configured tracker

Deliver tickets to the authorized destination. For a chat-only request, include the tickets in the response. For local files or an authorized tracker, the content stays the same while the blocking references change:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers it depends on, or None; numbers only, never titles, because the board derives blocked state from them. Use the per-ticket file template below: one ticket per file, never a single combined file. Finish by running `python3 -B .agents/scripts/progress.py --write`, which generates `PROGRESS.md` at the project root; never edit that board by hand.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply the `ready-for-agent` triage label unless instructed otherwise; the tickets are agent-grabbable by construction.

Work the **frontier**: the tickets that are open, unblocked, unclaimed and `ready-for-agent`, in any phase. For a purely linear chain that means top to bottom. The generated board lists the frontier under "Ready to claim".

Do NOT close or modify any parent issue.

<local-ticket-template>

# <NN>: <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Blocked by:** <numbers, or None>

**Status:** ready-for-agent

**Phase:** 1

**Verify:** 1

**Decision references:** applicable spec, experience brief, stack rationale, and prototype evidence. Omit irrelevant references.

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Decision references

Applicable spec, experience brief, stack rationale, and prototype evidence. Omit irrelevant references.

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)".

</issue-template>

In either form, avoid speculative implementation paths or code snippets that go stale. Keep links to durable decision documents and evidence. If a prototype produced a snippet that encodes a decision more precisely than prose can, inline only that decision and identify its source.
