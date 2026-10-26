# Agent hooks

Hooks run small, deterministic checks at useful points in an agent session. This package supplies shared Python helpers and separate registrations for Codex, Claude Code, and Cursor. Lifecycle checks and [prompt logging](USAGE.md) make no network requests and require no Python packages. The separate [optional Jev prompt hook](JEV.md) can make API calls only after it is explicitly configured and enabled.

<!-- reference-contents:start -->
## Contents

- [Enable in one project](#enable-in-one-project)
- [What runs](#what-runs)
- [Source checks and application checks](#source-checks-and-application-checks)
- [Local evidence](#local-evidence)
- [Check the actual host](#check-the-actual-host)
- [References](#references)
<!-- reference-contents:end -->

## Enable in one project

Install the instruction package first, then register the hooks for your tool:

```bash
bash /path/to/MyNewAgent/setup.sh --harness codex /path/to/project
cd /path/to/project
python3 -B .agents/scripts/setup_hooks.py --harness codex .
```

In the source folder itself, use:

```bash
python3 -B scripts/setup_hooks.py --harness all .
```

Supported registration targets are `codex`, `claude`, `cursor`, and `all`. Instruction support for other harnesses does not imply hook support. Other command-capable hosts can call the shared runtime with `--harness portable` and map their own lifecycle events to it. Use the ordinary validation commands when your host cannot run these events.

Registration modifies project configuration only. Existing unrelated settings and hooks are preserved. Repeating registration updates the package's own handlers, including registrations written by earlier releases, and keeps an existing Jev opt-in. Replaced configurations are backed up locally; interrupted or failed writes are handled by the registration script's rollback path. Review the generated commands as executable code.

Each generated command runs only the package of the project whose configuration holds it: Claude Code's project directory, or the nearest folder above the working directory that contains the host's hook configuration. If that project's runtime is missing, the hook fails with an error rather than running code from another directory. Paths inside the project must not be symlinks. Commands run Python in isolated mode (`python3 -I`), so files in the project folder cannot replace standard-library modules and `PYTHON*` environment variables are ignored.

Registration enables the local conversation logger by default: prompts on UserPromptSubmit (Cursor: beforeSubmitPrompt), and the agent's final reply on Stop (Cursor: afterAgentResponse). `--no-prompt-log` registers the lifecycle checks without either and removes existing logger registrations. For Claude Code, `--local` writes `.claude/settings.local.json`, keeping the shared `.claude/settings.json` free of this package's handlers so collaborators are not opted in by a committed file. A later registration without `--local` keeps writing there, with any Jev opt-in; to move the hooks back to the shared settings, run `--remove` first. `--jev-local` instead adds only the Jev hook to the local file and leaves the shared registration in place; a local file that holds only that hook does not count as a `--local` registration. If both settings files register these hooks, setup stops and asks for `--local` or `--remove` instead of guessing. If the local file cannot be read and might hold them, setup stops until you repair or delete that file. Setup warns while Git would commit the local file, and the installer adds the ignore rule.

Codex requires review and trust of new or changed non-managed hook definitions. Open `/hooks` in a new CLI session and review the registrations. Creating a configuration file does not establish that an IDE extension, remote runner, or particular installed version loaded it. Check the actual host's hook diagnostics before relying on it.

The runtime uses POSIX file locking and process groups on macOS, Linux, or WSL. Python 3.9 or newer is required. Native Windows execution is not supported by this runtime; run the checks directly or use WSL.

To remove this package's registrations while keeping other hooks:

```bash
python3 -B .agents/scripts/setup_hooks.py --harness all --remove .
```

Use `scripts/setup_hooks.py` in the source folder. The command removes only recognized package handlers and leaves unrelated settings in place. It does not delete the package or local evidence.

## What runs

For a custom runner, the lifecycle runtime accepts JSON on stdin and returns `{"event":"Stop","message":"...","followup":false}` with `--harness portable`. Call SessionStart before work, PostToolUse after relevant edits, and Stop when the agent finishes. Keep session and delegate identifiers stable. The caller must interpret `message` and the bounded `followup` request; the portable format does not itself enforce host behavior. POSIX runtime requirements still apply.

```bash
python3 -B scripts/agent_hooks.py --harness portable --event SessionStart <<'JSON'
{"session_id":"actual-session-id"}
JSON
```

| Event | Work | Limits |
|---|---|---|
| Session or subagent start | Establish a source snapshot and provide concise instruction and verification pointers. Resume can point to a saved local checkpoint. When `.scratch/<feature>/issues/` exists, a session start also regenerates the ignored `PROGRESS.md` and appends a plan note with the phase, the counts, the claimed ticket numbers and, in a workstream checkout, the branch, the owned paths and its own ready and blocked ticket numbers. A delegate start gets the counts only and is told not to edit ticket files. | Does not load every skill or infer new task authority. The plan note carries identifiers and numbers, never ticket text. |
| Project session start | Create project-root `prompt-log.md` if missing and preserve existing history. | File access and local writes must be available. |
| User prompt submission | Append sanitized prompt text to the local log through UserPromptSubmit or Cursor's beforeSubmitPrompt. | Redaction is best effort; logging failures allow the prompt to continue. |
| Agent reply | Append the sanitized final reply, linked to its prompt by `reply_to` when the host sends turn IDs, through Stop (`last_assistant_message`) or Cursor's afterAgentResponse (`text`). | Redaction is best effort; a long reply keeps its first and last 6 KiB; logging failures never block the agent. |
| After tool execution | Record which of the package's skills the agent loaded, then detect relevant package changes, including changes made through shell commands, and run the package validator. Read-only tools such as Read, Grep, and WebFetch skip the check. | Nearby checks are debounced, and a known failure for unchanged contents is not repeated. This checks structure and syntax, not product behavior. |
| Main agent completion | Recheck changed package contents and run source regression tests after relevant code changes. A passed, failed, or timed-out result is reused while its content fingerprint matches; an unavailable check is retried. While a plan exists, regenerate `PROGRESS.md` at every completion. Warn when code changed while a ticket stayed claimed without a Paused line, and in a workstream checkout when changed paths fall outside its owned paths or touch a shared path; these warnings reach the user, not the agent. A malformed ticket this session edited gets one bounded follow-up naming the ticket and its error code; one left by an earlier session is a warning. | Advice-only sessions do not trigger tests. A failing revision gets at most one automatic follow-up, and a turn gets at most one when the host supplies a turn identifier. The malformed-ticket follow-up leaves the baseline in place, so later completions repeat it as advice until the ticket is fixed; a malformed ticket owned by another workstream is advice only. |
| Coding subagent completion | Check for a current structured handoff with changed files, checks, and remaining work. | Self-reported evidence still needs parent review. Research delegates are not required to invent code changes or tests. |
| Before compaction | Save an observable file and check checkpoint. Regenerate `PROGRESS.md` and name the ticket claimed in this checkout, so the agent re-reads the board and the ticket file after compaction. | Does not scrape conversations, infer objectives, or create permission. Explicit handoff notes supply task context. |

A file change during verification invalidates the result for the later contents. Failed, timed-out, and unavailable checks remain distinct from passing checks. A follow-up asks the agent to fix an in-scope failure or report its limitation; it does not authorize a new task. Host interruption and stop controls remain available.

Cursor receives startup context at session start and validation feedback after tools. Of the plan-of-record messages, the agent receives the session-start note and the blocking follow-up in every host; the non-blocking completion notes are warnings for the user (`systemMessage` in Claude Code and Codex), and Cursor drops them. The board is still regenerated at completion, and the next session-start note and the board carry the claim state; a changed-paths warning is not replayed. Its subagent-start event only establishes a snapshot; that event cannot inject these notes into the delegate. If a host omits a stable delegate identifier, handoff checking reports that limitation instead of using the parent's state. Without a turn identifier, the runtime allows one follow-up until a successful completion resets its budget.

A coding handoff is required only when the delegate has an attributed edit event or an explicit `task_kind` of `code`. Hosts that omit attribution cannot reliably distinguish the delegate's edits from another agent's edits in the shared folder. In that case, record the handoff explicitly and have the parent review it; these hooks do not claim universal delegate enforcement.

The snapshot includes source and configuration files in common languages. Dependency, build, and cache directories, environment files, symlinks, and selected secret filenames are excluded. The generated root `PROGRESS.md` is excluded like `prompt-log.md`, so regenerating the board is never a consumer change; a `progress.md` elsewhere in the project still counts. Files over 2 MiB, files beyond a 64 MiB hashing budget, and unreadable files are tracked by size and modification time instead of content. Only a project with more than 20,000 tracked files disables automatic change detection; the limitation is reported once per session, and startup guidance still appears. This is not a secret scanner or a full filesystem audit.

## Source checks and application checks

In this source folder, hooks can run:

```bash
bash validate.sh
python3 -B -m unittest discover -s tests -v
```

The runtime invokes the validator through Python and records numeric exit results. Run the commands above for full diagnostics. Hook state does not retain command output.

Installed packages do not include the source regression suite. Their hooks validate `.agents/` when it changes and report that consumer application checks are not configured. The agent must discover and run the application's build, tests, and relevant integration checks. No command from a repository document or tool response is automatically executed as a test.

Browser checks remain separate. A successful build or package validator does not establish usable layout, keyboard behavior, responsive behavior, or visual quality.

## Local evidence

State is kept in a private user-owned temporary directory, separated by project, session, and agent. Concurrent invocations use a lock and atomic state replacement. Temporary storage may be cleared by the operating system, so it is not a durable project memory or a backup.

Automatic state contains source file hashes, changed paths, timestamps, and check statuses. It does not read transcripts or retain user prompts.

Skill usage is the one durable record. When an agent reads one of the package's `skills/<name>/SKILL.md` files, runs a shell command that names one, or invokes it through a host's Skill tool, the hook appends the skill name, how it was loaded, a hashed session, a hashed turn when the host supplies a prompt or turn ID, and the time to the private, gitignored project-root `.agent-evidence.jsonl`. It never records the path, the command, or the tool output. `python3 -B .agents/scripts/evidence.py report --format markdown` shows which skills are used and which are never loaded; see [USAGE.md](USAGE.md#review-skill-usage-and-routing-evidence). A manually recorded handoff can also include a short objective, decisions, and remaining work. Those notes are explicitly supplied local evidence, not instructions that override the current user request.

The progress board is not evidence either. `PROGRESS.md` at the project root is derived from the spec and ticket files under `.scratch/`, and the hooks regenerate it with `scripts/progress.py` at session start, at completion and before compaction. The generator reads local files only and never fetches or pushes. It writes only where `/PROGRESS.md` is ignored by Git, or where there is no Git checkout, and only when any existing file carries its marker; a hand-written file of that name is left alone and reported. The board shows where the plan stands. It proves no check ran and authorizes no action. The ticket files carry the Done lines and the evidence, and a commit of those files is the only way status crosses sessions and machines.

Record a handoff from the project root using the session and delegate identifiers supplied by the host. This synthetic example illustrates the contract; replace the identifiers, paths, and evidence with the actual work:

```bash
python3 -B .agents/scripts/agent_hooks.py --harness codex --record-handoff <<'JSON'
{
  "session_id": "actual-session-id",
  "agent_id": "actual-delegate-id",
  "task_kind": "code",
  "changed_files": ["src/example.py"],
  "checks": [{"name": "focused_tests", "status": "passed"}],
  "remaining_count": 0,
  "objective": "Correct the agreed parser behavior",
  "decisions": ["Preserved the existing input format"],
  "remaining": []
}
JSON
```

Use `scripts/agent_hooks.py` in this source folder and omit `agent_id` for the main agent. Check statuses are `passed`, `failed`, `unavailable`, or `timed_out`. The runtime fingerprints the current files; later source changes make that handoff stale. Successful recording returns `{"recorded":true}`. A rejected handoff exits with status 1 and returns `{"recorded":false,"error":"<reason>"}`, for example when a check name contains characters other than letters, digits, spaces, `_`, `-`, or `.`. Never record a passing check merely to satisfy the handoff shape.

## Check the actual host

Prompt and usage records are excluded from source fingerprints so logging does not repeatedly invalidate package checks. Default registration includes the local prompt and reply logger; `--no-prompt-log` omits it. `--jev` adds the separate network-capable suggestion handler for Codex and Claude Code; it does not replace logging. The logger does not create usage estimates from prompt length.

Source-regression checks have a 240-second process deadline; completion registrations allow 300 seconds for validation and cleanup. Passing checks are still reused only while the source fingerprint matches. These bounds accommodate the expanded regression suite without an unbounded completion loop.

After registration, start a fresh session. Confirm the startup note appears, make a small relevant change in a disposable copy, and confirm validation runs. Exercise a known failing fixture and check that completion requests only a bounded follow-up. Restore the fixture, rerun the check, and confirm the passing result applies to the restored contents.

The automated tests exercise the runtime and generated command contracts in isolated fixtures. They do not prove that every host version dispatches every event. Multiple tools can emit different payloads and support different output fields; the adapters deliberately keep their formats separate.

`tests/fixtures/hosts/` holds each host's documented hook inputs and allowed outputs, with the source and the date they were checked. `tests/test_host_contracts.py` runs them through the real runtimes. When a host changes its hook contract, update its fixture first; the failing tests show which runtime needs to follow. Each host names the current turn differently (Claude Code `prompt_id`, Codex `turn_id`, Cursor `generation_id`); every runtime reads the same ordered list, so prompt-log entries, skill loads, and Jev decisions for one turn share a key.

## References

- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Cursor hooks](https://cursor.com/docs/hooks)

Hooks supplement the [host permissions and sandbox](HARNESS.md#enforcement-outside-markdown). They do not authenticate task data, grant approvals, or guarantee instruction following.
