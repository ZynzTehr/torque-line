---
name: setup-pre-commit
description: Set up or adjust project-local pre-commit checks using the repository's existing ecosystem and tooling when the user requests hook configuration. Preserve current hooks, formatters, and commands; stack comparison alone does not invoke this workflow.
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/misc/setup-pre-commit
  changes: modified
  status: stable
  reviewed: 2026-10-04
---

# Set up pre-commit checks

Configure a fast, useful local check for the actual project. Do not introduce a JavaScript toolchain into a project simply to run hooks. A request to compare stacks or recommend tooling authorizes advice, not hook installation; apply the canonical autonomy policy to the proposed changes.

## Inspect the repository

Read the relevant manifests, lockfiles, contribution guidance, CI commands, formatter/linter configuration, and existing hook manager configuration. Inspect the repository's effective hooks path and any existing pre-commit behavior before changing it. Preserve unrelated hooks, commands, and configuration; never overwrite an existing hook or `prepare` script just to install another manager.

Identify the tools that already run locally and in CI. Reuse their documented project commands. Missing type checking or tests are limitations to report or decisions within the user's requested setup, not a reason to invent scripts that appear to pass.

## Choose the smallest compatible setup

- Extend the existing hook manager when one is present.
- For a JavaScript/TypeScript repository already using Husky and lint-staged, retain the selected package manager and existing formatter. Add only missing checks; do not reset style settings.
- For Python, Rust, Go, or a mixed-language repository, use its existing hook or task runner and language-appropriate checks. A native Git hook or an ecosystem-neutral hook manager can be sufficient; no package manager is the universal fallback.
- If there is no established setup, recommend one compatible option based on team operating systems, runtime availability, and the checks needed. Add dependencies only within the authorized hook-setup task and follow the dependency-management rule. Keep changes project-local rather than editing global Git or agent configuration.

Consult current official tool documentation for installation and hook syntax when needed. Do not copy a version-specific initialization command over an existing setup without checking its effects.

## Configure checks without disrupting work

Prefer fast formatting/lint checks on relevant changed files. Run broader type checks or tests when their cost is appropriate; keep the required CI gates authoritative. Do not silently weaken CI or require expensive full suites on every commit without a project reason.

Use the selected package manager's local executables and the project's existing commands. A hook should not fetch packages, install dependencies, or contact paid services during an ordinary commit. Give a clear diagnostic if a required local tool is missing.

Decide explicitly whether formatting checks or changes files. Preserve staged and unstaged work, including partially staged files; use a supported staged-file mechanism where needed, and do not add a broad `git add` command to hide the distinction. Handle filenames with spaces and the no-matching-files case. Preserve existing line endings and executable conventions when editing hooks.

## Verify and report

First inspect every command the hook will execute. Test its entry point in an isolated fixture or disposable worktree when running it in the current checkout could reformat, stage, or stash user work. Show that relevant valid input passes, a representative invalid input fails with a useful message, and unrelated or partially staged content remains unchanged where staged-file behavior applies.

Do not create a throwaway commit in the user's branch merely to exercise a hook. Confirm only the intended project configuration and dependency metadata changed, report the checks installed and how to run them directly, and state any unverified behavior. Commit delivery follows the user's task and the repository's Git discipline.
