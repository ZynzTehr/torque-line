# Workflow checks

These scenarios evaluate whether an agent uses the package's decision process. They complement `validate.sh` and the Python regression suite, which check package structure and installer behavior. They do not certify visual quality, production readiness, or award potential.

## How to run

Use a fresh session or an independent delegate with this package installed in a disposable project. Give it only the scenario prompt, the relevant fixture, and the normal instruction entry point. Keep the evaluator's criteria below out of its initial brief. Limit the first pass to a proposal so the evaluation cannot publish, install tools, or change a working project.

Capture the actual response or artifacts, the files it loaded, and its proposed next action. Mark each criterion as observed, failed, or untested, with evidence. A simulated proposal checks decision behavior only. Run a separate authorized build in a disposable project before claiming that an interaction or acceptance check works in practice. Record the package version, harness, model, and date when known.

Do not grade by exact words or a numerical creativity score. Look for decisions appropriate to the task. Re-run a failed scenario after fixing its demonstrated cause, rather than expanding every skill with speculative rules.

## A. Restrained application

**Prompt:** "Plan a professional scheduling tool for six receptionists. They need to find an appointment and reschedule it while speaking to a customer. Keep it familiar, dense enough for daily work, and quiet, with no decorative animation. We already use Vue and a Python API. Give me the proposed experience and implementation approach only."

**Fixture:** An existing Vue client, Python API, and a short description of the appointment search and rescheduling endpoints. No migration request.

**Observe:** The agent preserves the stack, follows the restrained brief, prioritizes the core task, and considers validation/conflicts and confirmation feedback. It avoids inventing a showcase interaction or restarting framework selection. It states how keyboard use and responsive composition would be checked. The planning-only request produces no edits or installations.

## B. Immersive public experience

**Prompt:** "Plan an expressive launch site for a small custom bicycle workshop. Visitors should explore the frame details and book a fitting. I like the pacing of the supplied reference. We have approved workshop photos but no 3D models. Mobile matters. Show your recommended direction and the first interaction you would prototype; do not build yet."

**Fixture:** Approved photo descriptions and reference observations with source URLs and dates. Mark which behavior was observed and which is unknown. No preselected application framework.

**Observe:** The agent develops a workshop-specific idea, retains the booking task, and accounts for missing assets. It distinguishes documented reference behavior from assumptions. It proposes alternatives only where the direction is open, scopes a narrow interaction experiment, and provides mobile, input, reduced-motion, and loading fallbacks. It evaluates technology against the needs rather than assuming that an expressive site requires a particular framework or 3D engine. It makes no claim that the concept guarantees awards or recall.

## C. Small change to an established identity

**Prompt:** "The form error overlaps the submit button on a narrow screen. Fix that layout while keeping the existing colors, typography, and animations. Explain the intended scope before editing."

**Fixture:** A small application with an established design document and the affected form. Provide the reproduction viewport and error state.

**Observe:** The agent inspects the affected layout, preserves the identity, and proposes a bounded fix and browser check. It does not require a new moodboard, a new design document, three concepts, or stack selection. In a separately authorized implementation pass, verify that the error remains readable and submission is usable at the failing viewport.

## D. Technology choice without a web frontend

**Prompt:** "Recommend a stack for a command-line tool that processes large local CSV exports on a locked-down Linux workstation. It must run offline after installation. Our maintainers know Python; there is no website or database requirement. Compare the meaningful options and assumptions in chat; do not install anything."

**Fixture:** Data sizes, available memory, allowed runtime versions, and representative transformations if known. Leave any genuinely unknown limits marked unknown.

**Observe:** The agent excludes unnecessary frontend, hosting, and database choices, compares viable approaches using the workload and operator constraints, and preserves the advice-only boundary. It verifies decisive compatibility claims or labels them unresolved. Where performance is uncertain, it proposes a representative measurement instead of promising speed from the language name. It does not add npm, ESLint, or Husky by default.

## E. Decisions survive handoff

**Prompt:** "Turn this agreed interface plan into a spec and implementation tickets in chat. Keep the existing stack and the approved restrained direction. The accepted prototype shows the bulk-edit flow. No tracker publication."

**Fixture:** A brief containing the core task, approved typography and colors, real content requirements, prototype evidence, keyboard behavior, an empty state, and a measured performance target.

**Observe:** The spec and tickets retain pointers to the same decisions and relevant experience acceptance. They include an assembled-flow review after contributing slices. They neither restart creative exploration nor discard the visual decisions as implementation details. They preserve the local delivery boundary.

**Follow-up:** "Review the implementation. The build passed, but no browser is available in this session."

**Observe:** The agent reports rendered and interaction verification as unavailable, without calling them passed. It can still review code and available evidence. It identifies what a later browser pass must check.

## F. Preserve project context

**Prompt:** "Add the agreed definition of a 'fitting' to our project glossary. It means a booked session where a mechanic adjusts the bicycle to the rider."

**Fixture:** An existing `CONTEXT.md` containing purpose, stack, experience direction, key decisions, conventions, and a domain terms section.

**Observe:** Only the relevant glossary section changes. The agent preserves the stack, decisions, and design reference instead of replacing the file with a glossary-only template.

## G. Resume from the board

**Prompt:** "Continue the booking project."

**Fixture:** A two-phase plan under `.scratch/booking/` with seven tickets: three done, one claimed with a Paused line under its Comments, the rest open or blocked. `PROGRESS.md` has been generated with `python3 -B .agents/scripts/progress.py --write`.

**Observe:** The agent names the current phase and the claimed ticket in its first reply without being asked. It resumes from the Paused line before editing anything. When the ticket is finished, it ticks the acceptance boxes, sets the Status to done, and adds the Done line with the check that ran and its evidence. It never edits `PROGRESS.md` and writes no status into `CONTEXT.md`.

**Follow-up:** "The submit button is misaligned, fix it."

**Observe:** The agent fixes it without claiming a ticket and without folding the change into the claimed one.

## H. Three workstreams

**Prompt:** "Use workstreams to set up backend, frontend and security in separate sessions."

**Fixture:** The same plan after phase 1, in a Git repository with a bare `origin`, with `.scratch/`, `.agents/` and the shared hook registration tracked.

**Observe:** The tracked-files check runs before anything is created. Phase 1 contracts stay frozen. The Owns globs are disjoint and the Shared paths are named in `workstreams.md`. The exact command and first prompt for each harness are printed. A session started in the `ws/booking/frontend` worktree claims only its own tickets and merges the integration branch forward before each claim. The integrator merges done commits in ascending ticket order, runs the project's checks after each one, and aborts a merge whose checks fail. A conflicting hunk whose intents cannot coexist stops with a question instead of a guess. Fold back removes only `workstreams.md`.

## Recording a run

Use the project's existing evaluation log, or a local scratch note. Record the scenario, input fixture, response/artifact location, observed decisions, failures, untested criteria, and the next check needed. Keep captured private project content local. A favorable planning response is evidence about instruction following, not a substitute for building and driving a real application.
