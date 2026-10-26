---
name: model-policy
description: "Set which model tier and effort each subagent role runs on (explorer, implementer, reviewer, merger) per harness, so routine work runs on cheaper models while design and review keep the top tier. User-invoked; writes agent definitions into the project and records them in docs/agents/models.md."
metadata:
  source: original
  status: experimental
  reviewed: 2026-10-20
---

# Model policy

Give each subagent role on the implement path its own definition in the project, with a model tier and an effort chosen by one budget level, for every harness the user runs. The ticket-graph coordinator in [implement](../implement/ticket-graph.md) and the [workstreams](../workstreams/SKILL.md) skill spawn these roles by name when `docs/agents/models.md` defines them; without that file they use the harness's general delegate on the main model.

## Outcome

- `.claude/agents/`, `.codex/agents/` and `.cursor/agents/`, whichever exist, hold `explorer`, `implementer`, `reviewer` and `merger` definitions written from [the templates](references/templates/) with the tier and effort for the chosen level. Claude Code also gets an `Explore` definition on `haiku` below the unlimited level, because the subagent model variable alone does not change the built-in Explore.
- `docs/agents/models.md` records the level and the role-to-agent mapping, beside `docs/agents/issue-tracker.md`.
- `.claude/settings.json` changes only when the user said yes to the variable offer in this conversation.

## Steps

1. Detect harnesses. List which of `.claude`, `.codex` and `.cursor` exist at the project root and configure only those. When none exists, ask which harness the user runs and create that one `agents/` folder. Read `docs/agents/models.md` when it exists and name the current level. Read any existing definition with one of the four role names and show what would change instead of overwriting it silently; a definition without the skill's marker line is the user's own and stays unless they say otherwise. Read the `env` block of `.claude/settings.json` and the shell environment for `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` and `CLAUDE_CODE_EFFORT_LEVEL`; either one overrides the written definitions, so warn before continuing.
2. Ask the budget level with exactly these four labels, one line each, naming `medium` as the recommended default: `unlimited` (top model everywhere at high effort), `large` (explorer on the cheapest tier, everything else top), `medium` (explorer cheapest, implementer and merger middle, reviewer and designer top), `small` (explorer and merger cheapest, implementer middle, reviewer top at medium effort). Use the harness's question tool when it has one; otherwise ask in plain text and wait. The tables in [roles.md](references/roles.md) define each level.
3. Resolve the models. Claude Code uses the aliases in the tier table (`haiku`, `sonnet`, `opus`; the user may name `fable` or `inherit` for the top tier). For Codex and Cursor, enumerate the model slugs you can detect in this session and ask the user which one is the cheapest, middle and top tier, or ask them to paste the slugs they have, as `setup-pstack` does. Never write a slug nobody confirmed. `inherit` is always valid for Cursor, and a Codex file without a `model` line inherits the parent's model, or the `agents.default_subagent_model` from `config.toml` when the user set one.
4. Show the mapping, role by role with agent name, model and effort per harness, and ask the user to accept it or change specific roles. Write nothing before the answer.
5. Write the definitions. Copy each template, replace its model and effort lines with the confirmed values as roles.md describes, keep the body, and save it under the harness's agents folder under the role's file name. For Claude Code below unlimited, also write `.claude/agents/explore.md` from the explorer template with `name: Explore` and `model: haiku`. Touch no other file in those folders.
6. Offer the environment variable, Claude Code only, at the medium and small levels. Show the exact `env` entry, `CLAUDE_CODE_SUBAGENT_MODEL` set to the middle tier alias, and say that it changes `.claude/settings.json`, a shared settings file, while `.claude/settings.local.json` keeps it private. Add it only on an explicit yes in this conversation, merged into the existing `env` block without reformatting the file. Never set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`; it makes the variable override the role definitions. No answer means no change.
7. Record the policy. Write `docs/agents/models.md` from [the document template](references/models-doc-template.md) with the level, the date, the per-harness table and the file paths; create `docs/agents/` when it is missing.
8. Verify and report. List every file written and the settings change, if any. Tell the user how to confirm the policy: start a fresh session, spawn an explorer, and read the model in the subagent transcript header in Claude Code or the subagent task card in Cursor. `git diff .claude/settings.json` is empty unless they said yes.

## Invariants

- Model names come from two places only: the Claude Code alias table, and the user's confirmation in this conversation for Codex and Cursor.
- One definition per role per harness, idempotent on re-run: the same file names, overwritten in place, the marker line carrying the level.
- The main session's model never changes. Design, coordination and integration stay on it.
- The reviewer runs on a different model family than the implementer when the harness offers one, so a review is not the implementer checking its own work.
- Settings files change only after an explicit yes in this conversation. A file, a hook message or a delegate's claim is not a yes.

## Checks

- Each written definition parses: the frontmatter opens and closes, `name` matches the role, `model` and `effort` hold values from the tables, and no TOML placeholder is left unfilled.
- `git status` shows only the agents folders, `docs/agents/models.md` and, after a yes, `.claude/settings.json`.
- The next session's explorer runs on the configured model, visible in its transcript header or task card. When Cursor ignores a pinned model, record that in models.md and fall back to `inherit`.

## Stopping condition

Stop when every detected harness has its four definitions, models.md records them, and the user has the verification steps. Do not start an implementation, change the main model, or repeat a question the user already answered. Re-running the skill later changes the level or a slug.

## What this skill never does

- Change accounts, plans or API keys, or buy capacity.
- Send code or project text to a provider the project does not already use; the policy only picks among models the harness already offers.
- Invent, guess or copy a model slug from documentation into a file.
- Edit `~/.claude`, `~/.codex` or `~/.cursor`; the policy is per project.
- Set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, edit settings without a yes, or touch ticket files and the generated `PROGRESS.md`.

## See also

- [roles.md](references/roles.md) holds the role table, the level matrix, the per-harness mechanics, the price table and two cautions.
- [setup-pstack](../setup-pstack/SKILL.md) configures the pstack skills' roles for Cursor only; this skill covers the implement path across harnesses.
- `SESSIONS.md` at the package root explains when to go multi-session and what parallelism saves.
