# Setup guide

Install the shared instructions into a project and create the entry points its harness reads. Run `bash validate.sh` for the current rule, skill, and script inventory and validation result.

The core policy is portable Markdown. Adapters cover Codex, Claude Code, Gemini CLI, Cursor, GitHub Copilot, and Antigravity. Other harnesses need their own instruction entry point to load the same files. See [HARNESS.md](HARNESS.md) for exact locations, capability fallbacks, documented sources, and enforcement limits.

<!-- reference-contents:start -->
## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Verify the installation](#verify-the-installation)
- [Start a project](#start-a-project)
- [Update a project](#update-a-project)
- [Remove the package](#remove-the-package)
- [Optional agent hooks](#optional-agent-hooks)
- [Version and maintenance](#version-and-maintenance)
<!-- reference-contents:end -->

## Requirements

- Bash and Python 3.9 or newer for installation and validation; only the Python standard library is used.
- Git for worktree audits and their regression tests.
- A harness that can read instructions and local files, or a way to supply those files as context.

The installer does not install dependencies, connect accounts, change global harness settings, or enable broad tool permissions. Specialized skills may need platform-specific tools. `deslop`, `control-ui`, `control-cli`, `Comment Sicko`, and `poteto-agent` are optional: [HARNESS.md](HARNESS.md) defines local or general-agent alternatives. A missing tool needed to verify a property must be reported, never disguised as a passing check. poteto-mode's PR watcher (`skills/poteto-mode/scripts/watch-pr/watch-pr`) needs [Bun](https://bun.sh). On first run it installs its dependencies into `skills/poteto-mode/scripts/node_modules/`; the installer keeps that folder out of version control and preserves it across updates.

## Install

Keep this source package outside the target project. Quote paths containing spaces. The project must already exist.

```bash
bash "/path/to/myAgent/validate.sh"
bash "/path/to/myAgent/setup.sh" "/path/to/project"
```

The default `--harness all` installs every supported entry point. Select a smaller set when appropriate:

```bash
bash "/path/to/myAgent/setup.sh" --harness codex "/path/to/project"
bash "/path/to/myAgent/setup.sh" --harness claude "/path/to/project"
bash "/path/to/myAgent/setup.sh" --harness portable "/path/to/project"
```

Supported values: `all`, `portable`, `codex`, `claude`, `gemini`, `cursor`, `copilot`, `antigravity`. Every mode creates a root `AGENTS.md` pointer. Other modes add the adapter listed in [HARNESS.md](HARNESS.md). Instructions, rules, skills, and their resources live in `.agents/`.

Existing adapter text is retained outside a managed `myagent:begin` / `myagent:end` block. Invalid or ambiguous blocks are rejected. The Cursor adapter uses `alwaysApply: true`; a conflicting pre-existing header requires manual review rather than silent rewriting.

Installation rejects symlinked project paths, source/target overlap, unexpected destination types, and concurrent installs. On macOS, use canonical paths such as `/private/tmp` instead of a symlink alias such as `/tmp` when creating a test project. The package source itself may be reached through a symlink; the installer resolves its own location.

Codex, Gemini CLI, VS Code, and Antigravity read `.agents/` natively, so a project may already have files there. A first install refuses to replace any pre-existing file that differs from the package version and lists them. Move instructions you want to keep into the project-root `AGENTS.md` (outside the managed block) or into `.agents/LOCAL-RULES.md`, then rerun, or rerun with `--adopt` to back them up and replace them. Symlinks inside `.agents/`, such as a shared skill folder, are preserved; only a symlink on a path the package writes stops the install.

## Verify the installation

Run the deployed validator:

```bash
bash "/path/to/project/.agents/validate.sh"
```

Start a new session in the target project. Ask the agent to identify its instruction entry point, the canonical autonomy configuration path, and the active profile. Inspect the harness's loaded-instructions view or actual file-read/tool log when available; an agent's assertion alone is not proof.

Check these concrete results:

- The loaded core file is `<project>/.agents/AGENTS.md`.
- Autonomy comes from the adjacent `autonomy-config.md`, with safe as the default.
- The agent can read the rule index and a relevant skill even without native skill discovery.
- Harmless authorized local work proceeds, and read-only requests produce no edits.
- A request to continue does not silently change the profile.

Use [SECURITY-CHECKS.md](SECURITY-CHECKS.md) for behavioral scenarios in a disposable environment. Installation and static validation do not prove prompt-injection resistance. Keep the host sandbox, filesystem limits, network restrictions, and sensitive-action approvals enabled.

## Start a project

The shared entry point routes open technology decisions to [choose-stack](skills/choose-stack/SKILL.md) and substantial interface work to [creative-direction](skills/creative-direction/SKILL.md). These workflows can also be loaded by path when native discovery is unavailable.

State the product's main task, constraints, and any preferences already settled. Visual expression can be restrained, expressive, or immersive. A chosen framework does not determine that expression. Existing projects keep their stack and identity unless the requested work justifies changing them.

The combined `CONTEXT.md` records project purpose, technology, domain terms, and decisions. A substantial interface can use `DESIGN.md` or an existing design document for its direction, assets, interaction decisions, and acceptance checks. Specs and tickets carry links to those decisions through implementation and review. Small fixes use a shorter path.

A project with a spec and local tickets under `.scratch/<feature>/` also gets a generated `PROGRESS.md` at its root. `python3 -B .agents/scripts/progress.py --write` renders the current phase, the tickets in progress and by whom, what is ready, what is blocked, and how to resume. The hooks run it at session start and stop. The installer adds `/PROGRESS.md` to `.gitignore`, and the generator writes only where that rule is in place. Edit the tickets, not the board. Several sessions on one project, each in its own worktree, use the [workstreams](skills/workstreams/SKILL.md) skill. It needs the shared hook registration and a tracked `.scratch/` and `.agents/`, because a commit is the only way status crosses sessions.

Run [WORKFLOW-CHECKS.md](WORKFLOW-CHECKS.md) in a disposable project to evaluate these decisions. Its planning scenarios and a real browser-driven application check answer different questions; report them separately.

## Update a project

Run the same installation command with the updated source. The installer validates the source before changing the target.

- Files outside the package's managed paths, including custom skills, rules, and configuration, are retained.
- Package-owned files are updated. Local changes to them are reported and backed up; reconcile intentional customizations after reviewing the new policy.
- Retired files recorded in the previous package manifest are removed from the active installation and retained in the backup. Locally modified retirements are reported for review. Unrecorded project-local additions remain untouched.
- The existing valid `active_profile` selection is preserved in the new autonomy policy. Old local policy text is backed up rather than carried forward as stale security guidance. Invalid profile configuration stops installation.
- Adapter content outside the managed block is preserved. Changing `--harness` adds or updates selected adapters; it does not remove adapters from previous installs.
- Optional components keep their selection. `--with-jev` adds the Jev router, its evaluator, its `.env.example`, and its evaluation cases; `--without-jev` removes them, and is refused while a Jev hook is still registered. Installs made before components existed keep Jev if they already had it.
- Your own rules survive updates when you add them to `.agents/rules/` and link them from `.agents/LOCAL-RULES.md`. The installed `AGENTS.md` reads that file; the package never replaces it, and the validator checks that its links resolve. Do not link them from `RULES-INDEX.md`, which updates replace.

Backups use unique `.agents-backup-<timestamp>-<suffix>/` directories. Each contains the replaced destinations at their project-relative paths, including `.agents/` and any changed instruction entry points. A reinstall that would change nothing leaves the project untouched and makes no backup. The installer adds ignore rules for backups, staging directories, and locks to the project's `.gitignore`, so `git add -A` does not commit them; delete old backups yourself once you no longer need them. Caught replacement failures trigger rollback and remove the then-empty backup. This is not a filesystem-wide atomic transaction: process termination that cannot be caught, power loss, or rollback I/O failure can require manual recovery from the backup.

A `.myagent-install.lock/` directory prevents overlapping installers. If a prior process was killed, inspect the lock owner and confirm no installer is running before removing the stale lock and retrying. Preserve the backup and any staging directory until recovery is complete. Do not remove a live installer's lock.

For manual recovery, stop agents and installers, inspect the backup contents, and restore only the affected destinations after preserving any newer work. Do not blindly overwrite the whole project. Backups may contain private project configuration; keep them local and out of commits.

## Remove the package

```bash
bash "/path/to/myAgent/setup.sh" --uninstall "/path/to/project"
```

Uninstall works in the order that avoids broken hooks. It first removes this package's hook registrations, including `.claude/settings.local.json`, because a registered hook whose runtime is gone fails on every prompt. If a settings file that might still register them cannot be read, uninstall stops before changing anything; repair the file or remove those handlers by hand, then run it again. It then removes the managed block from each entry point, deleting entry points the installer created when nothing else remains in them. Finally it moves `.agents/` into a final `.agents-backup-<timestamp>-<suffix>-uninstall/` directory. Prompt history, local usage records, `.gitignore` rules, and earlier backups stay; delete them yourself if you no longer want them.

## Optional agent hooks

After installation, run `python3 -B .agents/scripts/setup_hooks.py --harness codex .` from the target project to register Codex lifecycle checks. Use `claude`, `cursor`, or `all` for the other supported registrations. In this source folder, the command is `python3 -B scripts/setup_hooks.py --harness all .`.

Hook registration is separate from package installation and updates. It preserves unrelated host settings, makes backups of replaced configurations, and leaves global settings and native trust decisions alone. Registration also enables the local prompt and reply logger for everyone who trusts the configuration; add `--no-prompt-log` to register the lifecycle checks without it, which also removes an existing logger registration. For Claude Code, `--local` writes `.claude/settings.local.json` instead of the shared `.claude/settings.json`, so collaborators are not opted in through a committed file. A later registration without `--local` keeps writing there, with any Jev opt-in; to move the hooks back to the shared settings, run `--remove` first. `--jev-local` instead adds only the Jev hook to the local file and leaves the shared registration in place; a local file that holds only that hook does not count as a `--local` registration. If both settings files register these hooks, setup stops and asks for `--local` or `--remove` instead of guessing. If the local file cannot be read and might hold them, setup stops until you repair or delete that file. Setup warns while Git would commit the local file, and the installer adds the ignore rule. Read [HOOKS.md](HOOKS.md) for event behavior, local evidence, activation checks, and coverage limits.

Jev is an optional component. [JEV.md](JEV.md) ships with every install as documentation, but the router, its evaluator, `.env.example`, and its evaluation cases are installed only with `--with-jev`. The installer never copies an actual source `.env` or changes the target project's `.env`. Jev defaults to disabled with zero allowed requests. Add `--jev` to hook registration only when you want its optional prompt adapter available; live calls still require a key, an enabled flag, and a positive local allowance. Cursor gets no Jev hook because its prompt hook cannot deliver a suggestion; use the portable JSON command there.

## Version and maintenance

Installation initializes project-root `prompt-log.md` only when missing and appends ignore patterns for local prompt/usage records, the generated `PROGRESS.md`, backups, and locks to `.gitignore`. Both changes use the installer's backup/rollback transaction. Existing prompt history remains project-owned and is not part of the package manifest. Default hook registration captures new prompts and the agent's replies unless you pass `--no-prompt-log`; [USAGE.md](USAGE.md) explains the portable fallback, redaction limits, and the budget-review skill. A project requesting read-only work can defer manual initialization until writes are authorized.

`.agents/.version` records the source version, deployment source, and installation time. A source under your home directory is written as `~/…`, so a committed `.agents/` does not reveal your user name. `.agents/.myagent-manifest.json` records hashes for package file ownership/change reporting; it is not a signature or proof that a package is trustworthy.

When changing the package:

1. Update `VERSION` with a release version and date.
2. Maintain `resources.json` when adding or removing required skill companions. Its `resources` map lists paths relative to the owning skill's directory; examples in prose do not declare dependencies. Its `capabilities` list records optional capabilities and fallbacks.
3. Run the verification commands below.
4. Review the changed instructions and scripts, then reinstall into a disposable project and check its harness entry point before updating working projects.

```bash
bash validate.sh
python3 -B -m unittest discover -s tests -v
```

Validation checks required entry points, metadata, skill provenance and lifecycle fields, current third-party notices, invocation settings that agree across hosts, relative links in skill files and in the top-level documents it ships, rule/index consistency, profile syntax, declared resources, shell syntax, and Python syntax against the 3.9 minimum, including forms that newer interpreters accept, such as quotes reused inside f-strings, starred indexes, and nested async comprehensions. It rejects secret values in the distributed `.env.example` and never opens `.env` or other private files. In an installed copy, it uses the ownership inventory to check package files, reports package files modified since installation, and reports project-local rule and skill additions outside that coverage; it does not certify those additions. `bash validate.sh --verbose` also lists optional capabilities and their fallbacks. Regression tests use temporary projects and Git worktrees to exercise installation, rollback, preservation, and audit behavior. They neither execute every specialized skill nor launch every supported harness.

The README presentation reference is [ZynzTehr-Portfolio](https://github.com/ZynzTehr/ZynzTehr-Portfolio/blob/main/README.md), inspected on 2026-10-02. Its concrete capability descriptions, architecture overview, and direct setup path informed the organization. The reference supplies presentation ideas only; this package's behavior and commands come from its local files and verification.

For a machine without Bash, use WSL or another supported Bash environment. For a harness without file access, supply the reviewed core instructions and required references through its own context mechanism; copying a folder alone cannot activate them.
