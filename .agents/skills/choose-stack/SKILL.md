---
name: choose-stack
description: Choose or compare application languages, frameworks, runtimes, storage, hosting, and major libraries for a new project or an explicitly scoped technology decision. Preserve an existing or user-selected stack during ordinary implementation and design work.
metadata:
  source: original
  status: stable
  reviewed: 2026-10-04
---

# Choose a stack

Recommend the smallest coherent stack that meets the product's requirements and that its maintainers can operate. Visual ambition, a reference website, or the existence of a framework-specific skill does not determine the stack.

## Establish what is already decided

Inspect the existing application, manifests, lockfiles, deployment configuration, and decision notes before proposing technologies. Preserve the user's explicit choices and the established stack. Ordinary UI polish or a new feature is not a reason to reopen architecture. When the requested outcome exposes a real limitation, describe that limitation and the migration cost before proposing a change; implementation still follows the task's authorized scope.

For a new project, distinguish hard constraints from preferences and unresolved assumptions. Find observable facts in the repo. Ask only for consequential missing decisions such as the deployment environment, maintainers' experience, budget, or target devices; reuse answers already given in an interview.

## Compare the decisions that are actually open

Separate the layers so a frontend preference does not silently choose the backend, database, and host:

| Layer | Questions that change the choice |
|---|---|
| Frontend and rendering | Public content or an authenticated workspace? Static, server-rendered, or client-rendered needs? Interaction complexity, accessibility, discoverability, device support, offline behavior, real-time updates, and asset delivery? |
| Backend, runtime, and language | Is a backend needed? What integrations, computation, latency, concurrency, data-processing libraries, and deployment restrictions must it support? |
| Storage | What data relationships, query patterns, consistency, retention, backup, local-first or synchronization needs matter? Is persistent storage needed yet? |
| Hosting and operations | What can the team deploy, monitor, secure, and restore? What are the region, recurring cost, scaling, portability, and service-dependency constraints? |
| Optional libraries | What concrete gap remains after platform and existing framework capabilities? What does the library add to runtime cost, accessibility, maintenance, and integration complexity? |

For each consequential unresolved choice, compare two or three credible alternatives. Skip a comparison when a hard constraint or explicit user choice already settles it, and state why. Include the existing solution or a simpler platform-native option when viable. Do not produce a catalog of every framework or assign arbitrary numerical scores.

Evaluate complete combinations for compatibility as well as individual tools. Use actual requirements and maintainer experience, not stereotypes such as a particular framework being inherently professional, creative, small-project-only, or the universal default. More services and libraries need a concrete benefit, not a possible future use.

## Check consequential claims

Verify facts that could decide the outcome against current official documentation or primary sources: supported runtime versions, lifecycle/support policy, deployment compatibility, licensing, accessibility capabilities, relevant performance evidence, and pricing at the expected usage. Record the source and date where time matters. Marketing claims and an empty vulnerability report do not establish suitability.

Separate observed project facts, documented capabilities, assumptions, and estimates. Performance depends on the workload and implementation; do not promise it from a framework name. If a decisive claim remains uncertain, identify the smallest prototype or measurement that would resolve it. Report unavailable research or measurement honestly and keep the recommendation conditional where necessary.

A comparison does not install packages, change hooks or configuration, create cloud resources, subscribe to services, or migrate the application. Any follow-on implementation must fit the user's existing authorization. Apply the package's dependency-management rule before adding libraries.

## Deliver the decision

Give a short recommendation with the reason it fits the product. Include only the meaningful alternatives, their accepted tradeoffs, unresolved assumptions, and a concrete revisit trigger such as an unmet latency target or unsupported deployment requirement. Do not imply that another stack must be replaced merely because it is less familiar.

For an authorized project setup or implementation task, record the decision in the existing decision document or `CONTEXT.md` Key decisions, linking any longer comparison only when its detail will be reused. For an advice-only request, return the comparison in chat without creating files. Preserve existing decisions and document only the layers that needed a choice.
