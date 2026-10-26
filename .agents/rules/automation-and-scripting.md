---
trigger: glob
globs: "**/*.sh, **/*.bash, **/*.zsh, **/Makefile, **/Dockerfile, **/.github/**, **/*.yml, **/*.yaml, **/scripts/**"
description: "Apply when creating or changing shell scripts, automation, CI workflows, build files, or container definitions."
---

# Automation and scripting

## Build the lever, not the repetition

When the work is not trivial, build the tool that does it instead of doing it by hand. A codemod, script, or generator does the work the same way every time and reruns for free. The tool is the artifact a reviewer can read and rerun to verify the work.

- Do the first unit by hand to learn the recipe, then build the tool. Prove it by rerunning on that unit and diffing against the hand-done version.
- Codemod for edits, generator for repetitive files, script for analysis, rerunnable check for verification.
- A deterministic lever beats fan-out. If the tool can process every unit in one pass, run it yourself instead of delegating hand-application.

## Make operations idempotent

Every script, command, lifecycle step, or processing loop should converge to the same end state regardless of partial prior runs. Designed for crashes, restarts, and retries.

- Use `mkdir -p`, not `mkdir`. Use `CREATE TABLE IF NOT EXISTS`, not `CREATE TABLE`.
- Check whether the operation already completed before running it. Skip gracefully if done.
- Never leave the system in a state where rerunning the script produces a different (or broken) result.
- Name scripts by what they achieve, not what they do: `ensure-db-migrated.sh` not `run-migration.sh`.

## Shell script standards

- Always start with `#!/usr/bin/env bash` and `set -euo pipefail`.
- Quote all variable expansions: `"$var"`, not `$var`.
- Use `[[ ]]` for conditionals, not `[ ]`.
- Fail loudly on missing dependencies: check for required tools at the top of the script.
- No magic numbers or hardcoded paths. Use variables or arguments with defaults.
- Include a usage message if the script takes arguments.

## CI/CD discipline

- Pipeline steps should be idempotent and cacheable.
- Pin dependency versions in CI. No `latest` tags in production pipelines.
- Fail fast: run the cheapest checks (lint, type-check) before the expensive ones (build, test, deploy).
- Secrets go in environment variables or secret managers, never in config files or code.

## Dockerfile standards

- Use multi-stage builds to keep images small.
- Pin supported base image versions or digests appropriate to the application's runtime; avoid floating `latest` tags.
- When the build permits, copy dependency manifests and resolution files before application source, then use the selected ecosystem's reproducible install command to reuse cached dependency layers.
- Run as a non-root user. Do not use `USER root` in the final stage.
- `.dockerignore` should exclude secrets, `.git`, local dependency environments, and irrelevant build artifacts for the selected stack. Retain files that the intended build actually needs.
