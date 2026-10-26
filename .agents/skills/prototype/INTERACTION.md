# Interaction Prototype

Use a short, representative slice to answer whether an interaction feels right and remains usable under real inputs. Test a chosen interaction or a small set of competing behaviors. This branch does not require another layout exploration.

## Define the decision

State the question, intended user outcome, and observation that will settle it. Examples include whether a gesture reveals useful information, whether a transition preserves orientation, or whether a scene remains responsive on the target device. “Make it impressive” is not an observable acceptance check.

Use the [prototype skill's context criteria](SKILL.md#choose-the-context) to choose the host route or a scratch artifact. Use representative content and assets when their scale, contrast, weight, or timing affects the experience. Identify any substitute that limits the conclusion.

## Build the smallest complete behavior

Implement the relevant start, active, settled, interrupted, and reset states. Record:

- The trigger and supported inputs, including keyboard and touch where relevant.
- The response, including duration, easing or spring behavior, sequencing, and when content becomes usable.
- What happens when the action repeats, reverses, is interrupted, loses focus, or is navigated away from.
- Reduced-motion behavior and a useful static or simpler fallback when optional media or rendering cannot run.
- Loading and failure states that could alter the decision.

Give the evaluator a clear reset or replay control and a way to leave the experiment. Keep prototype controls outside the intended composition or hide them for capture. Preserve semantic controls and usable focus. Do not require hover for essential content or intercept standard navigation keys merely to make the effect work.

Keep the rest of the page cheap. High fidelity belongs in the behavior under evaluation, not in an unrelated full application. Compare two or three behaviors only when they answer an unresolved choice; one complete slice is enough to validate an already selected direction.

## Observe it in use

Read the applicable [accessibility](../../rules/accessibility.md) and [performance](../../rules/performance.md) guidance. Drive the interaction with supported inputs, including rapid repetition, cancellation, resize, and return navigation when those cases apply. Check reduced motion deliberately. Test touch on an available touch device or emulation and name which was used.

Capture interaction observations or a recording where supported. Screenshots document states but cannot demonstrate timing, smoothness, or response. Inspect the target viewport and content conditions; do not infer mobile quality from a desktop render.

Measure runtime and loading against the brief's budgets when the decision depends on them. State device, browser, network conditions, and method. Distinguish a measured result from “appears smooth in this run.” Note untested integration, unavailable devices, or substituted assets.

## Return the result

Report the behavior tested, evidence, remaining limits, and recommendation. Keep accepted timing, input mapping, fallback, recovery behavior, and performance conditions with the design decision so production work preserves them. Rewrite or harden the implementation as required by the real application; a successful prototype does not waive production checks.
