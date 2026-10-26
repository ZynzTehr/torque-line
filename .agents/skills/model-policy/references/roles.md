# Roles, budget levels and harness mechanics

The model-policy skill maps four subagent roles on the implement path to a model tier and an effort per budget level, then writes one definition per role for each harness the project uses. This reference holds the tables the skill reads, the way each harness resolves a subagent's model, the prices behind the tiers, and two cautions to apply before trusting a cheaper model.

## Roles

| Role | What it does | Default tier (medium level) | Effort | Notes |
|---|---|---|---|---|
| explorer | Finds files, conventions and the places a ticket touches, and returns pointers, never dumps | cheapest | low | Read-only. The role the coordinator spawns most, so its tier matters most |
| implementer | Builds one ticket on its own branch, runs the named check, reports evidence or INCONCLUSIVE | middle | medium | Never edits ticket files; the coordinating session owns Status |
| reviewer | Tries to refute a change and reports findings with file and line, then a verdict | top | high | Runs on a different model family than the implementer when the harness offers one, so the review is independent. Also the verifier for tier 2 and tier 3 tickets |
| merger | Merges the commit the brief names (the implementer's final commit, or a done commit in parallel mode) with --no-ff --no-commit, runs the checks, commits or aborts | middle | medium | Never force-pushes or rebases. In parallel mode the integrator session does this itself |
| designer | Design, synthesis and coordination | top | the session's | No definition is written. This work stays in the main session on its own model |

The tier for each role at the other levels comes from the next table.

## Budget levels

Each cell gives the tier and the effort. "top" is the dearest tier among the user's confirmed choices for that harness, "middle" the next one down, "cheapest" the lowest.

| Level | explorer | implementer | reviewer | merger | designer |
|---|---|---|---|---|---|
| unlimited | top, high | top, high | top, high | top, high | top, high |
| large | cheapest, low | top, medium | top, high | top, medium | top, high |
| medium (recommended) | cheapest, low | middle, medium | top, high | middle, medium | top, high |
| small | cheapest, low | middle, medium | top, medium | cheapest, low | top, high |

The shapes follow the cost of a wrong answer. Exploration is cheap to redo and its output is pointers, so it moves to the cheapest tier at every level below unlimited. A wrong review costs the most, so review keeps the top tier until the small level, which lowers only its effort. A merge is mechanical work with checks behind it, so the merger drops a tier before the implementer does. The designer row records that design and coordination never leave the main session.

## Tiers per harness

| Harness | cheapest | middle | top | Where the effort goes |
|---|---|---|---|---|
| Claude Code | `haiku` | `sonnet` | `opus` | the `effort` field (`low`, `medium`, `high`, `xhigh`, `max`) |
| Codex | confirmed slug | confirmed slug | confirmed slug | the `model_reasoning_effort` key |
| Cursor | confirmed slug | confirmed slug | confirmed slug, or `inherit` | an option appended to the model ID, such as `[effort=high]`, when the model accepts one |

Claude Code aliases come from the official list: `haiku`, `sonnet`, `opus`, `fable`, a full model ID, or `inherit`. `opus` is the default top tier. A user who wants the reviewer on the main session's model names `fable` or `inherit` when confirming the mapping. Codex and Cursor slugs are never taken from documentation or memory. The skill enumerates the slugs it can detect in the session, or asks the user to paste theirs, then asks which slug is which tier, the way `setup-pstack` does for the pstack roles. Cursor's `inherit` is always valid and carries no effort. A Codex file without a `model` line inherits the parent's model, or the `agents.default_subagent_model` from `config.toml` when the user set one.

## How the skill rewrites a template

The templates under `templates/` are written for the medium level. For each role and harness the skill copies the template, keeps the body, and replaces only these lines:

- Claude Code (`templates/claude/<role>.md`): `model:` gets the tier's alias and `effort:` gets the effort from the level table. The marker comment at the top of the body records the level.
- Codex (`templates/codex/<role>.toml`): `model =` gets the confirmed slug, or the line is removed when the user confirmed none; `model_reasoning_effort =` gets the effort. The first comment line records the level.
- Cursor (`templates/cursor/<role>.md`): `model: inherit` becomes the confirmed slug, with the effort option appended when the user confirmed the model accepts one, or stays `inherit`. The first comment line records the level.

At the unlimited level every role gets the top tier at high effort and Claude Code gets no Explore override. A file name is the role name (`explorer.md`, `implementer.toml`), except the Claude Code override, which is `explore.md` with `name: Explore`, because Claude Code matches the name field and not the file name.

## Claude Code

Claude Code resolves a subagent's model in this order: the per-call model override, then the `model` field of the definition in `.claude/agents/<name>.md`, then the `CLAUDE_CODE_SUBAGENT_MODEL` environment variable, then the main conversation's model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` makes the variable win over the definitions, which is why the skill never sets it; it would put the reviewer on the same model as everything else. The definition's frontmatter takes `name`, `description`, `model`, `effort`, `tools` and other fields, and `tools` is a comma-separated list such as `Read, Grep, Glob, Bash`. A project subagent named `Explore` with `model: haiku` overrides the built-in Explore. The environment variable alone does not change the built-in Explore's model, so the skill writes that override at every level below unlimited. The variable can live in the `env` block of `.claude/settings.json`; the skill offers that change and applies it only on a yes. Sources: [subagents](https://code.claude.com/docs/en/sub-agents) and [environment variables](https://code.claude.com/docs/en/env-vars).

## Codex

Custom agents are per-agent TOML files under `.codex/agents/` for the project or `~/.codex/agents/` for the user. A file must define `name`, `description` and `developer_instructions`, and may set `model` and `model_reasoning_effort`. A file without them inherits the parent's model and reasoning effort, unless `agents.default_subagent_model` and `agents.default_subagent_reasoning_effort` in `config.toml` set a default for every subagent; an explicit value in the file or at spawn time wins over both. The sandbox and approval settings cannot be overridden per agent, so the explorer's and the reviewer's read-only rule lives in their instructions. The skill writes project files only and never edits `config.toml`; a user who wants one default for every Codex subagent sets those two keys there. Source: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## Cursor

Custom subagents are markdown files in `.cursor/agents/<name>.md` with the frontmatter fields `name`, `description`, `model` (`inherit` or a model ID, with options such as `[effort=high]` appended to the ID), `readonly` and `is_background`. The orchestrating agent may request a model per Task call, which overrides the file. Forum reports exist of a pinned model being ignored, so verify in the subagent task card the first time. When the pinned model does not take, record it in `docs/agents/models.md` and fall back to `inherit`. Source: [Cursor subagents](https://cursor.com/docs/subagents).

## Prices and allowances

API rates per million tokens, from the pricing reference cached on 2026-10-06, as listed in [SESSIONS.md](../../../SESSIONS.md):

| Model | Input | Output |
|---|---|---|
| Claude Fable 5.1 | $10.00 | $50.00 |
| Claude Opus 5.5 | $4.00 | $20.00 |
| Claude Sonnet 5.5 | $2.00 | $10.00 |
| Claude Haiku 5.5 | $0.10 | $0.50 |

On a subscription, session and weekly limits are shared across models, with extra per-family limits for Opus and Sonnet. How much each model draws down the allowance is not documented, so the table shows API ratios, not subscription savings. Check `/usage`, which breaks usage down including subagents, before and after a level change, and record what you see with `scripts/usage_budget.py` so `budget-review` can compare levels later.

## Two cautions

Judge cost per completed task, not per request. A cheap implementer that needs two retries and a review pass costs more than the middle tier that got it right once. Compare usage per done ticket between levels before making a level a habit.

Measure the capable model at lower effort before building a cascade. On the newest models, low effort often matches a prior generation at high effort, and one model at the right effort is easier to reason about than three tiers. The `large` level is that experiment: the top tier everywhere except exploration, with the effort lowered on the routine roles.
