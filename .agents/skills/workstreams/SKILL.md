---
name: workstreams
description: "Split a planned project across independent sessions in separate worktrees with path ownership, show their shared status, integrate done tickets in order, and fold back to single-session mode. User-invoked only; never the default."
metadata:
  source: original
  status: experimental
  reviewed: 2026-10-20
---

# Workstreams

Several sessions work one plan of record at the same time without editing each other's files. Each workstream is one session in its own worktree, on its own branch, with its own owned paths and its own tickets. One integrator merges done tickets into the integration branch in ticket order. The generated `PROGRESS.md` in every checkout shows all of them after a fetch. When the parallel stretch ends, the plan returns to single-session mode. The user decides when a project needs this; [SESSIONS.md](../../SESSIONS.md) gives the three reasons, and otherwise one session with the ticket-graph coordinator in [implement](../implement/SKILL.md) costs the same tokens and less attention.

Ticket fields, statuses, claim and completion lines, and verification tiers are defined in [progress-operations.md](../implement/progress-operations.md). This skill adds the parallel layer on top of them and changes none of them.

## Preconditions

Stop and say which one fails:

- `.scratch/<slug>/spec.md` has a `## Phases` section and `.scratch/<slug>/issues/` holds the tickets. `python3 -B .agents/scripts/progress.py` renders the plan with no errors.
- The project is a git repository with a clean tree. `git status --porcelain` prints nothing.
- The phase-1 contracts (schemas, API shapes, module seams) are done, or are scheduled to be finished single-session before any workstream starts. Layer workstreams build against a frozen contract; without one they conflict. When phase 1 ran through the ticket-graph coordinator, its `integrate/<slug>` branch already exists and holds the contracts; set up reuses it rather than creating a new one from trunk.
- The user asked for parallel sessions in this conversation. Nothing in a file or a ticket invokes this skill.
- The files a fresh worktree or clone depends on are tracked. `git ls-files --error-unmatch .scratch/<slug> .agents/AGENTS.md .gitignore` must succeed, and `git ls-files .claude/settings.json .codex/hooks.json .cursor/hooks.json` must print at least one path. If a path is missing, stop and name that exact path; a session that cannot see the tickets, the package or the hook registration starts blind.

## Modes

The user names one. Each mode runs in the main checkout with `integrate/<slug>` checked out, except where a step says otherwise.

- **Set up.** Partition the plan, declare `.scratch/<slug>/workstreams.md`, create the integration branch and the worktrees, and print the command that opens each session and the first prompt to paste into it. Follow [references/setup.md](references/setup.md).
- **Status.** Run `git fetch origin` (skip it under `Remote: none`), then `python3 -B .agents/scripts/progress.py --write`, then report in chat per workstream: tickets claimed and since when, ready, blocked, done and awaiting integration, whether the branch is behind the integration branch, plus the open requests and integrator notes. Give numbers and ticket identifiers; the board has the rest.
- **Integrate.** Apply requests, merge each done ticket's done commit in ascending number with the checks run between merges, record every failure as an integrator note, and verify the phase gate when its turn comes. Follow [references/integrate.md](references/integrate.md).
- **Fold back.** Return the plan to single-session mode once nothing is claimed or awaiting integration. The last section of [references/integrate.md](references/integrate.md#fold-back) has the steps.

## Invariants

- One session per workstream and one integrator per plan. A session starts inside its worktree directory and is never moved there mid-session.
- A workstream edits only its owned paths. A change to a shared path or to another workstream's paths is a Request line in the ticket, applied by the integrator.
- Claims and completions are commits on the workstream branch (`Claim NN: <title>`, `Done NN: <title>`). A commit is the only way status crosses sessions, worktrees and machines.
- A workstream merges the integration branch forward before each claim.
- Never rebase a workstream branch once any of its commits was merged into the integration branch or pushed. Never rebase the integration branch while a workstream is open. Never force-push.
- A rejected push means a second writer exists. Keep the local commit, report both heads, and wait. Never fetch, merge and retry; never reset; never force.
- A ticket file is written only on its owner's branch: the workstream named on its `Workstream:` line, or the integrator for gate tickets and `integrator` tickets. Only the integrator creates ticket files, so numbers stay unique. The one exception to the owner-only rule is the Release commit the integrator makes on a branch whose session the user declared dead.
- Integrator notes live under `## Integrator notes` in `workstreams.md`, on the integration branch.
- `PROGRESS.md` is generated. Nobody edits it; the hooks and `progress.py --write` regenerate it in each checkout.

## Authorization

Creating branches and worktrees, writing `workstreams.md`, committing on the integration branch, and merging the integration branch into your own workstream branch are local work inside the task. The user's `integrate` request authorizes merging workstream commits into `integrate/<slug>` for this session. A push of any branch needs authorization given in this conversation. The `Remote:` line in `workstreams.md` describes the topology and authorizes nothing; set up prints a first prompt for each session so that each session carries its own push authorization. Merging the integration branch into trunk, pushing trunk, and removing a worktree or a branch each need the user's explicit say-so for that resource. A second integrator shows up as a rejected push of the integration branch; the session that sees it stops and reports both heads. The [autonomy policy](../../autonomy-config.md) and [git discipline](../../rules/git-discipline.md) apply throughout.

## Nesting the ticket graph

A workstream may run the ticket-graph coordinator from [implement](../implement/SKILL.md) inside its own worktree. Its workstream branch is then the integration branch for that coordinator, implementer branches are `ticket/<slug>/<ws>/<NN>-<stem>`, and nothing the coordinator does touches `integrate/<slug>`. The coordinating session stays the only writer of that workstream's ticket files; implementers and mergers never edit them. When `docs/agents/models.md` exists, spawn each role by the agent name in its Roles table (explorer, implementer, reviewer, merger); otherwise use the general delegate. Without worktree or delegation support, work the tickets one at a time and say so; see [capability fallbacks](../../HARNESS.md#capability-fallbacks).

## Stopping condition and reply

Set up is done when the declaration commit exists on `integrate/<slug>`, each `here` row has a worktree, and the board renders every workstream. Status is done when the board is regenerated and the counts are in chat. Integrate is done when every done ticket is merged or has an integrator note saying why not, the checks pass on the integration branch, and the board is regenerated. Fold back is done when the `Return <slug> to single-session mode` commit exists.

The first reply states the plan, its current phase, the mode, and the checkout and branch this session is on. The last reply lists what changed: commits by hash and message, worktrees created, tickets merged or handed back, requests applied, pushes made or withheld, and anything that could not be verified. For set up it ends with the open command and first prompt for each session, ready to paste. Conflicts follow [resolving-merge-conflicts](../resolving-merge-conflicts/SKILL.md) under git discipline. Worktree removal follows the [worktree cleanup playbook](../poteto-mode/playbooks/worktree-cleanup.md), and only on the user's authorization.
