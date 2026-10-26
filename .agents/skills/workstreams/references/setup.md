# Set up workstreams

The `set up` mode of the [workstreams skill](../SKILL.md). It turns a plan of record into two to four path-owning workstreams on their own branches and worktrees, with one integrator, and ends with the command and the first prompt the user needs for each session. Everything here is local work except the pushes, which wait for the user's word in this conversation. One example runs through every section: a `booking` plan with a `backend` workstream in Codex and a `frontend` workstream in Claude Code, both on this machine, and a `security` workstream in Cursor on the user's laptop. The main checkout is the folder `myrepo`.

<!-- reference-contents:start -->
## Contents

- [Check](#check)
- [Partition](#partition)
- [Declare](#declare)
- [Create](#create)
- [Open](#open)
- [First prompt](#first-prompt)
- [Session rhythm](#session-rhythm)
<!-- reference-contents:end -->

## Check

Run the skill's preconditions before changing anything, in this order, and stop at the first failure with the exact path or command that failed:

1. The plan parses. `python3 -B .agents/scripts/progress.py` prints the board without an `### Errors` section. Fix the ticket fields first if it has one.
2. The spec has phases. `.scratch/<slug>/spec.md` carries a `## Phases` section and every phase has a gate ticket titled `Phase N review`. A plan without phases has no gate for the assembled-flow review that parallel work needs; add them with `to-spec` and `to-tickets` first.
3. The tree is clean. `git status --porcelain` prints nothing; uncommitted work is invisible to every other session.
4. The contracts are frozen. The phase-1 tickets that fix schemas, API shapes and module seams are done, or the user agrees to finish them single-session before the worktrees open.
5. The shared files are tracked, so a worktree or a clone sees them:

   ```
   git ls-files --error-unmatch .scratch/<slug> .agents/AGENTS.md .gitignore
   git ls-files .claude/settings.json .codex/hooks.json .cursor/hooks.json
   git check-ignore -q PROGRESS.md && echo ignored
   ```

   The first command must succeed. The second must print the registration for each row's harness (`.claude/settings.json` for claude, `.codex/hooks.json` for codex, `.cursor/hooks.json` for cursor), which is what regenerates the board and injects the start note in that session. The third must print `ignored`; the installer adds `/PROGRESS.md` to `.gitignore`. Name the missing path and stop; the user adds it and commits.
6. The remote. `git remote get-url origin` decides the `Remote:` line. A workstream on another machine needs `origin`; a plan whose sessions all run on this machine can use `none`.
7. An existing integration branch. `git branch --list integrate/<slug>` shows whether phase 1 left one behind; the ticket-graph coordinator creates it, and the Create step reuses it instead of starting a new one from trunk.

## Partition

Two to four workstreams. Each row owns a disjoint set of path globs: no path belongs to two rows, and a path nobody owns belongs to the integrator. List the project's top-level folders (`git ls-files | cut -d/ -f1 | sort -u`) and assign each one to a row or to the Shared list before writing anything.

There are two ways to cut, and the ticket shape follows from the cut:

- By feature area, the default. A workstream owns the folders of one feature (its schema, API, UI and tests) and every ticket stays fully vertical, as `to-tickets` wrote it.
- By layer (backend, frontend, security). A ticket is vertical within its workstream's owned paths against the phase-1 frozen contract. A frontend ticket is demoable against contract fixtures or stubs; a backend ticket is verifiable through contract tests. The phase gate is the assembled-flow review, where the integrator drives the real flow across the layers.

Security as a hardening workstream owns its own paths (`auth/`, `middleware/`, `tests/security/`) and writes Requests for changes elsewhere. It never edits another row's paths to apply a fix.

Wide refactors stay single-session. An expand-contract sequence touches every row's paths; finish it before set up or after fold back.

The Shared list names the paths the integrator alone edits: the manifest and its lockfile, the migrations folder, `.github/`, `CONTEXT.md`, the spec, `workstreams.md`, and `decisions.tsv`. A shared path may sit inside an owned folder (Rails keeps migrations under `db/migrate/`); the Shared line wins, and the Stop hook's advisory names a change to a shared path even inside an owned folder.

If the project keeps a show-me-your-work decision log, `decisions.tsv` belongs to the integrator and each workstream logs to `decisions-<name>.tsv` in its own worktree, so no two sessions append to one file.

Then assign the tickets. Every ticket gets a `**Workstream:**` line naming the row whose paths cover its work. A ticket that needs two rows' paths is split with `to-tickets`, or given to the integrator. Gate tickets and any ticket the integrator will do get `integrator`. Check the frontier per row: a row whose first ticket is blocked by another row's ticket starts idle, which is acceptable only when the user knows it.

## Declare

Write `.scratch/<slug>/workstreams.md`. For the booking example:

```
# Workstreams: booking

Base: main
Integration: integrate/booking
Remote: origin
Shared: package.json, package-lock.json, migrations/, .github/, CONTEXT.md, .scratch/booking/spec.md, .scratch/booking/workstreams.md, decisions.tsv

| Workstream | Branch | Owns | Harness | Where |
|---|---|---|---|---|
| backend | ws/booking/backend | api/, db/ | codex | here |
| frontend | ws/booking/frontend | web/ | claude | here |
| security | ws/booking/security | auth/, middleware/, tests/security/ | cursor | laptop |

## Integrator notes
```

`Base` is the trunk branch and `Integration` the branch every workstream starts from and merges forward. `Remote` is `origin` or `none`; it records the topology and never authorizes a push, which comes from the user inside each conversation. `Shared` is the comma-separated list from the partition. In the table, `Workstream` is a short name, `Branch` is `ws/<slug>/<name>`, `Owns` lists comma-separated path globs with a trailing slash on folders, `Harness` is `claude`, `codex` or `cursor`, and `Where` is `here` or a machine name; set up creates local worktrees only for `here` rows. `## Integrator notes` starts empty and later holds one `- NN: <note>` line per handback, decision needed, ownership violation or applied request.

Then edit the tickets. Add `**Workstream:** backend` (or the row that owns the ticket) under the `**Status:**` line of each ticket, and `**Workstream:** integrator` on every gate ticket and on any ticket the integrator keeps. In parallel mode a claim line reads `**Claimed by:** backend (codex@mbp), 2026-10-21`, the workstream first and the harness and host in parentheses.

These edits are committed as `Declare workstreams for <slug>` on `integrate/<slug>`. When the branch does not exist yet, the commit is the second command of the next section; when phase 1 left it behind, switch to it and commit there.

## Create

Run these in the main checkout, in this order. `<repo>` is the main checkout's folder name, here `myrepo`; the worktrees are its siblings.

```
git switch -c integrate/booking main    # or, when phase 1 left the branch: git switch integrate/booking && git merge --no-edit main
git add .scratch/booking
git commit -m "Declare workstreams for booking"
git worktree add -b ws/booking/backend ../myrepo-booking-backend integrate/booking
git worktree add -b ws/booking/frontend ../myrepo-booking-frontend integrate/booking
git branch ws/booking/security integrate/booking
```

One `git worktree add -b ws/<slug>/<name> ../<repo>-<slug>-<name> integrate/<slug>` per `here` row; a row on another machine gets only its branch, created from `integrate/<slug>`, and checks it out there after a push. The main checkout stays on `integrate/<slug>` as the integrator's checkout.

Pushing is not part of the local work. Ask in this conversation, naming every branch, and run the push only after the user says yes:

```
git push -u origin integrate/booking ws/booking/backend ws/booking/frontend ws/booking/security
```

Under `Remote: none` there is nothing to push; the worktrees share one repository, so every branch is visible in every checkout without a fetch.

Finish with `python3 -B .agents/scripts/progress.py --write` and read the `### Workstreams` table on `PROGRESS.md`: one row per workstream with its branch, owned paths, harness, where it runs, and the command that opens it.

## Open

Each session is opened from inside its worktree. From the main checkout:

| Row | Harness | Command |
|---|---|---|
| backend, here | Codex | `cd ../myrepo-booking-backend && codex` |
| frontend, here | Claude Code | `cd ../myrepo-booking-frontend && claude` |
| any `here` row | Cursor | `cursor ../myrepo-booking-<name>` |

A row on another machine clones and switches. On the laptop, for the security row:

```
git clone <origin url> myrepo-booking-security
cd myrepo-booking-security
git switch ws/booking/security
cursor .
```

The clone sees the package, the hook registration and the tickets because they are tracked; `python3` must be on that machine's PATH for the hooks to run.

Start every session inside the worktree directory. Never open a session in the main checkout and switch to a worktree later: Claude Code pins the project with `CLAUDE_PROJECT_DIR`, Codex and Cursor use the folder whose hook configuration was loaded, so the hooks would snapshot and regenerate the board in the original checkout, and a claim would land on the wrong branch. Sibling worktrees created with `git worktree add` are the documented layout. Claude Code's own `--worktree` flag keeps its worktrees under `.claude/worktrees/` inside the main checkout; the hooks skip that folder, and this package has not verified that the flag moves `CLAUDE_PROJECT_DIR`, so do not use it for a workstream.

In a workstream checkout the session start note names the workstream, its branch and owned paths, its own claimed, ready and blocked tickets, the other workstreams' claims, and ends with `Merge the integration branch integrate/booking before each claim.` A row declared for another machine sees `Declared to run on laptop; do not claim here unless the user moved it.` In the main checkout the note reads `Integration checkout for .scratch/booking/ at phase 1 of 2: 3 of 12 done; backend 4 open; frontend 3 open; security 2 open. Claim only integrator tickets here; use the workstreams skill to integrate.`

## First prompt

Files cannot grant permissions, so each session's push authorization travels in the first message the user types into it. Set up ends by printing one paragraph per session, filled in, for the user to paste. The template:

```
You are workstream <name> on ws/<slug>/<name>. Read PROGRESS.md and .scratch/<slug>/spec.md. Claim only your tickets per the progress operations, edit only <owned paths>, commit; you may push this branch to origin during this plan; run git fetch origin and merge origin/integrate/<slug> before each claim; run python3 -B .agents/scripts/progress.py --write if PROGRESS.md is missing; shared paths are requests to the integrator.
```

For the booking example, the three paragraphs are:

```
You are workstream backend on ws/booking/backend. Read PROGRESS.md and .scratch/booking/spec.md. Claim only your tickets per the progress operations, edit only api/ and db/, commit; you may push this branch to origin during this plan; run git fetch origin and merge origin/integrate/booking before each claim; run python3 -B .agents/scripts/progress.py --write if PROGRESS.md is missing; shared paths are requests to the integrator.
```

```
You are workstream frontend on ws/booking/frontend. Read PROGRESS.md and .scratch/booking/spec.md. Claim only your tickets per the progress operations, edit only web/, commit; you may push this branch to origin during this plan; run git fetch origin and merge origin/integrate/booking before each claim; run python3 -B .agents/scripts/progress.py --write if PROGRESS.md is missing; shared paths are requests to the integrator.
```

```
You are workstream security on ws/booking/security, in the laptop clone. Read PROGRESS.md and .scratch/booking/spec.md. Claim only your tickets per the progress operations, edit only auth/, middleware/ and tests/security/, commit; you may push this branch to origin during this plan; run git fetch origin and merge origin/integrate/booking before each claim; run python3 -B .agents/scripts/progress.py --write if PROGRESS.md is missing; shared paths are requests to the integrator.
```

Under `Remote: none`, replace "you may push this branch to origin during this plan" with "do not push" and "run git fetch origin and merge origin/integrate/booking" with "merge integrate/booking". A user who wants to authorize each push separately deletes the push clause; the session then asks before every push.

## Session rhythm

How a workstream session works a ticket. The integrator's rhythm is in [integrate.md](integrate.md).

1. Start inside the worktree. The start note names the workstream and its tickets; state the phase and the ticket you are taking in your first reply. Claim within the current phase only; a later-phase ticket on the frontier waits until the gate is done.
2. Before each claim, merge the integration branch forward: `git fetch origin && git merge --no-edit origin/integrate/booking` (under `Remote: none`: `git merge --no-edit integrate/booking`). This brings in integrated tickets, applied requests and reassignments, and it is what turns your blocked tickets ready.
3. Claim: set `**Status:** claimed` and `**Claimed by:** backend (codex@mbp), 2026-10-21`, save, commit `Claim 04: Cancel a booking`, and push with `git push origin ws/booking/backend` when this session was authorized to push.
4. Work in the owned paths only. A need outside them becomes a line under the ticket's `## Comments`: `- Request 2026-10-21: migration adding bookings.cancelled_at`. Commit and push it; the integrator applies the change on the integration branch, and you receive it at your next merge forward.
5. Complete: tick the acceptance boxes, set `**Status:** done`, add `- Done 2026-10-22: npm test passes (41 tests); review: code-review on sonnet; unverified: none`, and commit the ticket with the work as `Done 04: Cancel a booking`. Push when authorized. The done commit is what the integrator merges, so the ticket edit and the last code change travel together; the branch tip may already carry your next claim.
6. Stopping mid-ticket: add `- Paused 2026-10-22: <resume point>` and commit. Giving a ticket up: set `**Status:** ready-for-agent`, remove the `Claimed by` line, add `- Released 2026-10-22: <why>`, and commit.
7. A rejected push (`! [rejected] ... (fetch first)`) means another session pushed to your branch. Keep your commit, report both heads with `git rev-parse HEAD`, `git rev-parse origin/ws/booking/backend` and `git log --oneline HEAD...origin/ws/booking/backend`, and wait for the user. Never fetch, merge and retry; never reset; never force.
8. At every stop the hook regenerates `PROGRESS.md` and shows the user warnings: `If this change belongs to ticket NN (claimed), mark it done or add the Paused line; an unrelated change leaves the ticket alone.` when code changed under a claim that has no Paused line, and `Changed paths outside this workstream's owned paths or on shared paths: ...; revert them or request the change from the integrator.` when you strayed. A malformed ticket you edited in this session gets one blocking follow-up (`PROGRESS.md regenerated with ticket errors: ticket NN <code>, ... Fix the Status, Blocked by, Phase, or Workstream line`); an older malformed ticket, or another row's, is a warning (`Ticket NN (<workstream>) has <code>; its owner fixes it.`). Before compaction the hook names your claimed ticket so you re-read `PROGRESS.md` and the ticket afterwards. The warnings are for the user; the agent is reminded by the next session start note and the board, and Cursor drops the warnings entirely.
9. Under `Remote: none` there is no push, so the rejected-push tripwire does not exist and the one-session-per-branch rule is the only protection. Never open two sessions on one worktree.
