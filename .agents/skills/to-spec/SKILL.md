---
name: to-spec
description: "Turn the current conversation into a specification that preserves product, technology, and experience decisions. Use the configured tracker when publication is authorized; otherwise prepare the spec locally or in chat."
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/engineering/to-spec
  changes: modified
  status: stable
  reviewed: 2026-10-20
---

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

Use the project's existing spec location and tracker conventions. Missing tracker setup does not block a useful spec; follow [HARNESS.md](../../HARNESS.md) for a local fallback. Publication follows the user's authorized action and destination.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

Reuse agreed verification decisions. Ask only when an unresolved choice materially affects scope or acceptance; ordinary test placement does not need another approval.

3. Read the chosen stack rationale and experience brief when relevant. Preserve them in the spec and make unresolved decisions explicit. Write the applicable sections below, then deliver to the authorized destination. Use the project's triage vocabulary when publishing. A spec written to the local tracker (`.scratch/<feature-slug>/spec.md`) is followed by [to-tickets](../to-tickets/SKILL.md), which turns each phase into tickets and a gate ticket, and by the generated `PROGRESS.md` board described in [progress-operations.md](../implement/progress-operations.md).

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A concise list of user stories covering the actual scope. Each user story can use the format:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

Cover important success, failure, and recovery paths without inventing features to lengthen the list.

## Experience Acceptance

For UI work, link `DESIGN.md` or the existing experience brief. Carry forward the chosen expression, audience, core task, real content/assets, and validated prototype decision. State observable acceptance for affected routes and states, desktop/mobile composition, input methods, accessibility, motion fallback, and any distinguishing interaction. Include relevant performance targets and the evidence expected, using the [creative-direction review](../creative-direction/SKILL.md#review-the-experience).

For a small UI fix, record only the affected behavior and the existing identity to preserve. Omit this section when there is no UI. Do not invent a signature interaction for a restrained utility or treat missing browser evidence as a pass.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions
- Chosen technologies, accepted tradeoffs, and links to existing decision records

Avoid speculative implementation paths and code snippets that will go stale. Links to durable briefs, decision records, and prototype evidence belong here so implementers can recover the intent.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Phases

Write this section when the work spans more than one session; omit it otherwise. One line per phase, shaped `N. <Name>. <Goal>. Exit: <observable criterion>.` The Exit is something a later session can check, such as a named test passing or a flow working end to end. Name a person in an Exit only when a human review is required; that makes the phase's gate ticket `ready-for-human`, closed by that person. A project that may later run in parallel freezes its contracts and seams in phase 1, worked in a single session, so later phases can be split by owned paths. These are plan phases, tickets behind an exit criterion; they are not ask-matt's session phases, which are context boundaries inside one session.

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>
