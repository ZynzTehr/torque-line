---
name: prototype
description: Build a bounded prototype to answer a design question about logic, layout, or interaction feel. Compare alternatives when the direction is open, or test a narrow chosen interaction before production work.
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/engineering/prototype
  changes: modified
  status: stable
  reviewed: 2026-10-04
---

# Prototype

A prototype is a temporary artifact that answers a question. The question determines its location, fidelity, and evidence. Work within the existing brief; do not restart approved discovery or expand the product.

## Pick the question

- **Does this logic or state model work?** Use [LOGIC.md](LOGIC.md) for an inspectable state machine and guided cases.
- **Which composition or hierarchy serves this page?** Use [UI.md](UI.md) for structurally different variants that can be compared in the browser.
- **Does this interaction feel and behave as intended?** Use [INTERACTION.md](INTERACTION.md) for a narrow slice with representative assets, timing, input handling, and fallbacks.

Choose from the prompt and surrounding work. If multiple questions remain, isolate the consequential uncertainty first. A settled direction does not require another set of alternatives.

## Choose the context

Use the existing route, framework, and real surrounding layout when the decision depends on the host product's navigation, content density, data shape, or rendering behavior. Isolate the prototype with a development-only route or variant switch and stub mutations. Keep it visibly separate from the production experience.

Use a local scratch artifact when the experiment is independent of the host, there is no host yet, or a separate slice is needed to safely test a technique. Choose the lightest stack that preserves the behavior being evaluated. A vanilla sketch cannot establish framework integration or device behavior it does not exercise.

Follow project conventions. Make the prototype trivial to run and clearly mark its temporary purpose, question, and assumptions. Keep state in memory by default; use a separate disposable data store only when persistence itself is being tested.

## Match fidelity to the decision

Keep unrelated features, abstractions, and production hardening out of the experiment. Layout and logic sketches can stay rough. Interaction prototypes need enough visual, timing, input, and recovery fidelity to answer their question. Do not omit accessibility or fallback behavior when it could change the decision.

Inspect the result on the matching surface. Show relevant state for logic; compare renders for layout; drive the actual behavior for interaction. State what the prototype proves and what remains untested. A failed experiment is useful evidence, not a reason to hide its result.

## Capture the decision

Record the question, result, tradeoffs, run instructions, and useful evidence in the existing local design artifact or work record. Retain the prototype in an appropriate scratch location or local branch when it will help future decisions; follow the project's conventions and existing authorization for any external record.

Carry the validated decision and its acceptance checks into the real implementation. Prototype code is not automatically production-ready. Preserve user work during cleanup, and remove only temporary files created for this task when authorized and no longer needed. Report the artifact's actual location and status.
