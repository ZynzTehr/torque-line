---
name: skill-development
description: Create or improve reusable agent skills with concise instructions, selective references, and verified behavior. Use for skill authoring and reducing skill context, not ordinary execution of a task covered by another skill.
version: 0.2.0
license: Apache-2.0
metadata:
  source: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/plugin-dev/skills/skill-development
  changes: modified
  status: stable
  reviewed: 2026-10-04
---

# Create efficient, reusable skills

Turn a repeatable task into a skill that helps another agent complete it correctly with only the context it needs. Preserve useful capabilities, user work, and the target harness's permissions. Fewer words are useful only when the workflow still works.

## Find the right scope

Search existing skill names and descriptions before creating another entry. Improve the closest fit when its purpose matches; do not duplicate discovery metadata. For a skill that launches and drives an application to verify behavior, use [create-verification-skill](../create-verification-skill/SKILL.md) or its maintenance counterpart instead of inventing another verification system.

Establish the task, destination, target harness, expected artifact, available tools, and a representative request. Reuse answers already supplied. Ask only for missing choices that change the result. Default to the project's existing skill layout; global installation, hook registration, provider access, and publication are separate actions requiring the user's authorization.

For a revision, inspect the entrypoint and only the references implicated by the change. Preserve non-obvious constraints, callers, resource paths, invocation policy, and specialized modes. Consolidate repeated advice rather than silently dropping a capability.

## Write the smallest useful entrypoint

Use a matching folder and frontmatter `name`, with lowercase letters, digits, and hyphens. Write a short `description` stating the capability and when it applies; include a boundary where a neighboring skill could be confused with it. Preserve supported metadata. Do not change automatic invocation settings merely to save context.

In this package, every skill also carries a `metadata` block: `source` (`original`, or the upstream URL plus a top-level `license` and `changes: modified|none`), `status` (`experimental`, `stable`, `outdated`, or `deprecated` with `replaced_by: <skill>`), and the `reviewed` date. Update `reviewed` after checking a skill against current hosts and models. After changing provenance, run `python3 -B scripts/third_party_notices.py --write`.

Keep these in `SKILL.md`: the outcome, essential steps, invariants, checks, stopping condition, and conditional links. A short skill may need only this file. Do not pad it to a word target, repeat the host's general rules, or explain things the agent already knows. Put each detail in one maintained location.

| Material | Place and loading rule |
|---|---|
| Shared workflow and constraints | Entry file; read when using the skill |
| Mode-specific procedures, schemas, substantial examples | References; link each with a concrete condition for reading it |
| Repeated deterministic operations | A helper script only when it earns its maintenance cost; document input, output, and verification |
| Files copied into the deliverable | Assets; inspect only when needed |

For references over 100 lines, add a Contents list matching real headings outside code examples. Read that map or search headings, then retrieve the relevant sections with the available file tools. A Contents list does not cause partial loading automatically. Never omit required constraints to reduce context, and do not load every linked document by default.

## Load authoring details only when needed

- For a new file structure or a starting template, read [skill-template.md](references/skill-template.md).
- For skills distributed inside a Claude Code plugin, read [claude-plugins.md](references/claude-plugins.md). Other harnesses retain their own discovery paths and metadata.
- For comparison with the older methodology only, read [skill-creator-original.md](references/skill-creator-original.md). Its initializer and packager examples are not bundled tools or requirements of this workflow.

Keep the portable instructions usable through direct file reading. Claim native discovery only after checking the actual host; a Markdown skill cannot make unavailable tools or models available.

## Verify proportionately

Check frontmatter, naming, local links, declared resources, complete examples, and the availability of every command you recommend. Run new or changed executable helpers on a representative input and failure path. If editing this package, register owned companions in `resources.json` and run `bash validate.sh`; use `scripts/reference_contents.py --check` for long references. In another repository, use its actual checks rather than assuming those commands exist.

Check one intended request, one nearby request that should not select this skill, and one case that needs an optional reference. For a substantial workflow, exercise a realistic task in a disposable workspace and inspect the artifact; use an independent evaluator only when it adds useful confidence. Keep provider calls, live systems, and external writes within the user's approved scope. Static inspection alone does not prove native triggering or outcome quality.

After focused checks pass, rerun only for a new change, failure, or required project gate. Avoid repeated whole-repository reads, exhaustive reviews, or parallel delegates for a small writing task. Hand off the created files, a usable invocation, verification evidence, and unresolved limits.

For efficiency claims, compare entrypoint size before and after, references actually read, and task success. Lines, words, and bytes measure text size, not billable tokens. Use host/provider telemetry for token or cost comparisons when available; report unavailable measurements honestly. A smaller skill cannot reset a subscription's usage allowance.
