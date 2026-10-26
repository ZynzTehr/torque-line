# Integrate workstreams

The `integrate` and `fold back` modes of the [workstreams skill](../SKILL.md). The integrator runs in the main checkout on `integrate/<slug>`, applies the workstreams' requests, lands done tickets in ticket order with the checks run between merges, keeps the integrator notes, verifies the phase gates, and returns the plan to single-session mode at the end. The booking example from [setup.md](setup.md) continues here: `backend` on `ws/booking/backend`, `frontend` on `ws/booking/frontend`, `security` on `ws/booking/security`, integration branch `integrate/booking`.

<!-- reference-contents:start -->
<!-- reference-contents:end -->

## Who

The integrator is one session in the main checkout with `integrate/<slug>` checked out. Its start note reads `Integration checkout for .scratch/booking/ at phase 1 of 2: 3 of 12 done; backend 4 open; frontend 3 open; security 2 open. Claim only integrator tickets here; use the workstreams skill to integrate.` It writes three things, all on the integration branch: the `## Integrator notes` section of `workstreams.md`, the tickets whose `Workstream:` line says `integrator` (the gates and any ticket it kept), and the shared paths. It never edits a workstream's ticket file or branch, with one exception, the single Release commit on a branch whose session the user declared dead (see Release and reassign), and it does not implement workstream tickets. It is the only session that creates ticket files, so numbers stay unique.

Every run starts with `git fetch origin` (skipped under `Remote: none`) and `python3 -B .agents/scripts/progress.py --write`, then a read of the board's `### Requests`, `### Integrator notes`, `### Needs attention` and `### Workstreams` sections. A second integrator shows up as a rejected push of the integration branch; stop, report both heads, and wait for the user.

## Requests first

A workstream asks for what it may not do itself with a `- Request <date>: <need>` line under its ticket's `## Comments`; the board lists them under `### Requests`. The usual needs are a dependency in the manifest and lockfile, a migration number or file, a new ticket, a `CONTEXT.md` decision, or a spec change. Apply each one on the integration branch before merging anything: make the edit, run the checks, commit it as `Apply request from NN: <what>`, then add `- NN: applied <what> in <sha>` under `## Integrator notes` and commit that. A request you decline gets a note that says why. The workstream receives the change at its next merge forward.

A new ticket gets the next free number above every number on every branch (the board's `duplicate-number` error catches a collision after the next fetch), its `Workstream:` line names the row that will do it, and it is committed on the integration branch as the only copy.

## Order

```
git switch integrate/booking
git fetch origin
python3 -B .agents/scripts/progress.py --json
```

The JSON's `integration_order` list holds, per plan, one entry per done ticket that is not yet integrated, with `ticket`, `branch` and `sha`: the commit to merge is its done commit, the last commit on the owner's branch that touched the ticket file, never the branch tip, which may already carry the next claim's work in progress. Merge in ascending ticket number, one ticket at a time:

```
git merge --no-ff --no-commit <sha> -m "Integrate 04 from ws/booking/backend"
# run the project's checks, and rerun the check named in the ticket's Done line
git commit --no-edit
python3 -B .agents/scripts/progress.py --write
```

Ascending order matters. `to-tickets` numbered the tickets in dependency order, and a later ticket's done commit on the same branch descends from the earlier one, so merging the later one first drags both in under one name and the board can no longer tell them apart.

When a check fails, abort and hand the ticket back:

```
git merge --abort
```

Add `- 04: handed back 2026-10-22, npm test fails on integrate at <sha> (api/bookings.test.ts)` under `## Integrator notes` and commit it. The owner fixes the problem on its branch and commits the fix together with a new Done line in the ticket; the done commit is the last commit that touched the ticket file, so a fix without the ticket edit would not be picked up. The ticket returns on the next run. Continue with the next ticket only when it does not depend on the aborted one; a dependent ticket stays blocked on the board.

After the last merge, run the checks once more on the integration branch and regenerate the board. The report lists each ticket with its merge commit, each handback with its note, and the branches now behind the integration branch.

## Lockfiles and generated files

Lockfiles and generated files are never hand-merged. In a conflicted merge, take either side (`git checkout --ours -- package-lock.json`, or `--theirs`), regenerate it with the ecosystem's locked install (`npm install`, `pnpm install`, `uv lock`, `cargo generate-lockfile`, or the project's equivalent), stage the result, run the checks, and continue the merge. Generated clients, snapshots and bundles are regenerated from the merged source the same way. `PROGRESS.md` never conflicts because it is ignored.

## Trunk drift

When trunk moved, merge it into the integration branch: `git fetch origin && git merge --no-edit origin/main` (under `Remote: none`: `git merge --no-edit main`), run the checks, and commit. The workstreams receive trunk's changes through their next merge forward. Never rebase the integration branch while a workstream is open: every workstream has merged it forward, and a rebase would duplicate each of its commits on their next merge. For the same reason a workstream branch is never rebased once any of its commits was merged into the integration branch or pushed.

## Conflicts

Resolve a conflict inside the `--no-ff --no-commit` merge with the mechanics of [resolving-merge-conflicts](../../resolving-merge-conflicts/SKILL.md): see the state, find each hunk's primary sources (the ticket, its commits, the request that changed the shared path), resolve each hunk preserving both intents, run the checks, then `git commit --no-edit`. The always-on [git-discipline](../../../rules/git-discipline.md) rule governs the one case the skill does not cover: when the two intents cannot coexist, run `git merge --abort`, add `- 04: Decision needed: <commit on ws/booking/backend> vs <commit on integrate/booking>, <what conflicts>` under `## Integrator notes`, commit the note, and ask the user. The imported skill's "never --abort" yields to the rule here. A conflict is never resolved by rewriting the workstream's branch, and a resolution the checks have not passed is never committed.

## Publish

Pushing the integration branch is not covered by the `integrate` request. Ask once per session, naming the branch (`Push integrate/booking to origin after each merge?`), and push only after the yes: `git push origin integrate/booking`. A rejected push means a second integrator exists; keep the local commits, report both heads, and stop. Under `Remote: none` there is nothing to push; the worktrees see the integration branch directly.

## Gate

When every other ticket of a phase is integrated, the board shows `Phase N review` as ready. The gate is the integrator's own ticket. Claim it on the integration branch (`**Claimed by:** integrator (claude@mbp), 2026-10-23`, commit `Claim 07: Phase 1 review`), then verify the phase's Exit criterion at tier 3: the project's checks on the integration branch, one independent `code-review` pass, an `interrogate` review when the skill is available, the assembled flow driven end to end for UI work, and the user's sign-off. Record the Done line with that evidence and commit `Done 07: Phase 1 review`. A `ready-for-human` gate is closed by the user on the integration branch: the integrator prepares the evidence, and the user sets the status or asks the integrator to write it. The next phase starts after the gate is done; the workstreams stay within the current phase until then.

## Trunk

When the user wants the integration branch delivered, usually after the plan's last gate or at a phase boundary, prepare it: the checks pass on the integration branch, `git log --oneline main..integrate/booking` summarizes what lands, and either a pull request or the commands `git switch main && git merge --no-ff integrate/booking` are ready. Run none of it without the user's explicit say-so. The `integrate` request covers workstream commits into the integration branch only; merging into trunk and pushing trunk are separate authorizations.

## Release and reassign

A dead session's claimed ticket moves in two steps, in this order:

1. Release on the dead branch. In its worktree, or in a temporary worktree for a branch that lives on another machine (`git worktree add ../myrepo-booking-security-release ws/booking/security` after a fetch), edit the ticket: `**Status:** ready-for-agent`, remove the `Claimed by` line, add `- Released 2026-10-24: session on the laptop ended`. Commit `Release 09: <title>` and push when authorized. The ticket's state is read from its owner's branch, so a change made only on the integration branch would leave the old claim in place; until this step lands, the dead claim keeps showing under `### In progress` (and as stale after seven days), and if you reassign before releasing, the board flags it under `### Needs attention` as an orphaned claim on the old branch.
2. Reassign on the integration branch. Change the ticket's `**Workstream:**` line to the new row, commit `Reassign 09 to frontend`, and push when authorized. The new owner merges the integration branch forward and claims.

Commits on the dead branch that are not in a done commit, and uncommitted files in its worktree, stay where they are. They move only on the user's instruction, by cherry-picking the named commits onto the new branch, and the dead worktree is not removed in this mode.

## Fold back

Fold back when the board shows nothing in progress and nothing awaiting integration: every done ticket is merged, every request is applied or declined, and no workstream holds a claim. On the integration branch:

```
git rm .scratch/booking/workstreams.md
git commit -m "Return booking to single-session mode"
```

The `Workstream:` lines in the tickets may stay; without `workstreams.md` the plan is in single mode and they are inert. Push when authorized. The plan then continues single-session on `integrate/<slug>`, with one session claiming per the progress operations or the ticket-graph coordinator, or it is delivered to trunk per the section above.

The worktrees and the `ws/<slug>/<name>` branches stay. Each may hold the only copy of unpushed commits or uncommitted files, so they are removed only when the user authorizes cleanup, through the [worktree cleanup playbook](../../poteto-mode/playbooks/worktree-cleanup.md) of the poteto-mode skill, one worktree at a time.
