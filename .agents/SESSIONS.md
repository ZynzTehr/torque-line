# Sessions, subagents and budget

How to run a project with this package without paying for parallelism that buys nothing, and without asking the agent where the project stands. This page is for the person running Claude Code, Codex or Cursor on one project, alone or with a few sessions side by side. The agent-facing rules live in [progress-operations.md](skills/implement/progress-operations.md) and the [workstreams skill](skills/workstreams/SKILL.md).

<!-- reference-contents:start -->
## Contents

- [One session is the default](#one-session-is-the-default)
- [Go multi-session only for a specific reason](#go-multi-session-only-for-a-specific-reason)
- [Parallelism buys time, not tokens](#parallelism-buys-time-not-tokens)
- [The approach, in order](#the-approach-in-order)
- [Choose models per role](#choose-models-per-role)
  - [Claude Code](#claude-code)
  - [Codex](#codex)
  - [Cursor](#cursor)
  - [Prices and allowances](#prices-and-allowances)
- [Verification tiers](#verification-tiers)
- [Session hygiene](#session-hygiene)
- [Which skill when](#which-skill-when)
- [What is verified and what is not](#what-is-verified-and-what-is-not)
<!-- reference-contents:end -->

## One session is the default

Most projects need one session. Plan once with `to-spec` (a spec with phases) and `to-tickets` (tickets with blocking edges), then run `implement`. For a whole spec, the implement skill's ticket-graph coordinator holds the plan, spawns one worker per ready ticket in its own worktree and branch, merges each one when its checks pass, and moves on. You get parallel work inside the session without becoming the coordinator yourself. The coordinator keeps ticket status and the generated `PROGRESS.md` current, so a session that dies can be picked up by the next one.

A small fix in a project without tickets needs none of this. Nothing engages until `.scratch/<feature>/issues/` exists.

## Go multi-session only for a specific reason

Open a second session, in a second worktree, when one of these holds:

- You want to spread work across two subscriptions. A Codex session on one workstream and a Claude session on another draw on two separate allowances. This is the strongest budget argument for multiple sessions.
- You want to steer and review two streams interactively at the same time. Subagents cannot ask you questions mid-ticket.
- The project runs over days and a single coordinator's context would not survive it.

Otherwise multiple sessions cost the same tokens, plus your attention as the human coordinator. When one of the reasons applies, use the `workstreams` skill. It gives each session its own branch, worktree and owned paths, and one integrator that merges done tickets in order.

## Parallelism buys time, not tokens

The same ticket costs about the same whether a subagent or a second session does it. Both add overhead: every fresh agent re-reads AGENTS.md, the rules, CONTEXT.md and the ticket, and a coordinator pays again to read each worker's report. The routing set alone (AGENTS.md, the rules index, the autonomy file and the five always-on rules) is about 23 KB, roughly five to six thousand tokens per agent before it reads any project file. That figure is an estimate from character count, not measured tokens.

Savings come from four other things:

- Smaller contexts. A long session re-sends its whole history every turn. Cached input is far cheaper than fresh input, so this hurts less than it looks, but quality drops and compaction loses detail. Fresh, bounded workers with a precise brief are cheaper per task than a bloated main session late in the day.
- Cheaper models for mechanical work. Subagents inherit the main model unless you say otherwise. Setting the subagent model to Sonnet and the explorer to Haiku is the single biggest lever, and it works in both layouts.
- Fewer conflicts and retries. A merge conflict or a worker that guessed wrong costs more than the ticket did. Path ownership and well-specified tickets matter more than the session layout.
- Lower effort on routine tickets. The effort setting trades thoroughness for tokens within one model.

Do not parallelize across phases. Phases are sequential by nature and exist so you can verify and review before the next one starts. Parallelize within a phase, across tickets whose blockers are done. That is what the ticket graph already models.

## The approach, in order

1. Plan the project once: a spec with phases, tickets with blocking edges, and the generated `PROGRESS.md` you open to see where things stand.
2. Set the subagent model to Sonnet and the explorer to Haiku before the first implementation session, and keep the most capable model for the coordinator, design, review and integration. The `model-policy` skill writes the per-harness agent definitions for you.
3. Run phase one in a single session with the ticket-graph coordinator. Note the usage breakdown from `/usage` at the end.
4. Open a second session only if one of the three reasons above applies, and then use `workstreams` with path ownership.
5. Compare usage per completed ticket between the two layouts before making either a habit. The `budget-review` skill reads the usage you record with `scripts/usage_budget.py`.

## Choose models per role

### Claude Code

Claude Code resolves a subagent's model in this order: a per-call model override, then the `model` field of the subagent definition in `.claude/agents/*.md`, then the `CLAUDE_CODE_SUBAGENT_MODEL` variable, then the main conversation's model. The definition field accepts `haiku`, `sonnet`, `opus`, `fable`, a full model ID or `inherit`, and there is a separate `effort` field.

Three things you can do today:

- Put `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` in the `env` block of the project's `.claude/settings.json`. Every subagent, teammate and workflow agent without its own model then runs Sonnet while the main session keeps its model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` makes it win over everything.
- Define a project subagent named `Explore` with `model: haiku`. The built-in Explore otherwise runs the main model (with Fable as the main model it drops to the Opus alias), and it is the subagent the skills spawn most.
- Use `/effort` for the session and the `opusplan` alias, which runs Opus in plan mode and Sonnet for execution.

Fast mode (`/fast`) is Opus-only and bills to usage credits outside plan limits. It is a speed lever, not a savings lever. No harness routes work to a cheaper model by task type on its own. The advisor tool is the inverse, a cheap main model consulting a strong one, and it is experimental and API-only.

### Codex

Custom agents live in per-agent TOML files under `.codex/agents/` (or `~/.codex/agents/`) with their own model and reasoning effort. A subagent without those keys inherits the parent's model and reasoning effort, and `agents.default_subagent_model` and `agents.default_subagent_reasoning_effort` in `config.toml` set the default for every subagent.

### Cursor

Custom subagents in `.cursor/agents/` take `model: inherit` or a model slug in their frontmatter, and the orchestrating agent can request a model per Task call. Forum threads report cases where a pinned model was ignored, so check the subagent transcript the first time. The `setup-pstack` skill configures the pstack skills' roles (swarm workers, arena runners, reviewers) for Cursor only.

### Prices and allowances

API rates per million tokens, from the pricing reference cached on 2026-10-06:

| Model | Input | Output |
|---|---|---|
| Claude Fable 5.1 | $10.00 | $50.00 |
| Claude Opus 5.5 | $4.00 | $20.00 |
| Claude Sonnet 5.5 | $2.00 | $10.00 |
| Claude Haiku 5.5 | $0.10 | $0.50 |

On a subscription, session and weekly limits are shared across models, with extra per-family limits for Opus and Sonnet. How much each model draws down the allowance is not documented. Check `/usage`, which breaks usage down including subagents, before and after you change the subagent model.

Two cautions. Judge cost per completed task, not per request; a cheap worker that needs two retries and a review pass is not cheaper. And before building a model cascade, measure the capable model at lower effort on the same tasks; on the newest models, low effort often matches a prior generation at high effort.

## Verification tiers

Rigor scales with blast radius, per ticket and per phase, so the best result at each stage does not cost a heavy review on every small ticket.

| Tier | When | What done means |
|---|---|---|
| 1 | Mechanical or reversible change | The ticket's named check passes, and whoever merges reruns it |
| 2 | Behavior change | Tier 1 plus one independent review (`code-review`), on a different model when the model policy names one |
| 3 | Phase gate, security change, one-way door | Tier 2 plus adversarial multi-model review (`interrogate`) and your sign-off |

`to-tickets` assigns the tier. The ticket's Done line records the check, the review and anything left unverified, and `PROGRESS.md` shows it. Nothing is re-reviewed without a change. The package distrusts confidence words and asks for evidence instead: a check that ran, a screenshot, a commit, or an honest "unavailable".

## Session hygiene

- Start a session inside its worktree directory (`cd ../repo-plan-backend && claude`, or `codex`, or `cursor .`). Switching worktree mid-session does not move the hooks: Claude Code pins the project with `CLAUDE_PROJECT_DIR`, and Codex and Cursor use the folder whose hook configuration was loaded, so the snapshot and the board would stay with the original checkout.
- Prefer fewer, broader workers. Each one pays the routing overhead above.
- Write briefs as context pointers (spec path, ticket path, commit), not pastes.
- At a phase boundary inside a session, work down the ask-matt tree in order: continue, clear, handoff, subagent, compact. See [PHASE-BOUNDARIES.md](skills/ask-matt/PHASE-BOUNDARIES.md).
- Keep the claim and the Done line current. The board is derived from the ticket files, so it is only as honest as they are. When code changed while a ticket stayed claimed without a Paused line, the Stop hook shows you a warning; the agent itself is reminded by the next session start note and the board.
- Run routine tickets at low or medium effort and reserve high and above for design, review and integration.
- Claude Code sessions on one machine can message each other; Codex and Cursor cannot. Coordination therefore stays in files and git, and messaging is an optional extra.

## Which skill when

| Moment | Skill |
|---|---|
| Decisions still open | `grilling`, then `choose-stack` and `creative-direction` when they apply |
| Turn decisions into a plan of record | `to-spec` (with phases), then `to-tickets` |
| Build one ticket or a whole spec | `implement` |
| Several sessions on one plan | `workstreams` (set up, status, integrate, fold back) |
| Cheaper models for subagents | `model-policy` |
| Review by tier | `code-review` (tier 2), `interrogate` (tier 3) |
| Where the project stands | Open `PROGRESS.md`; the session start note already says it |
| What the last weeks cost | `budget-review`, and `retro` for which skills earned their place |

## What is verified and what is not

Verified against the official documentation on 2026-10-20: the per-subagent model and effort controls and their resolution order, the API prices, that subagent requests draw on the allowance, fast mode's scope and billing, worktree and hook behavior, and cross-session messaging. An estimate: the per-agent routing overhead in tokens. Reasoning rather than measurement: that Sonnet matches the top model on well-specified tickets, and that smaller contexts save more than they cost. Unknown: how much each model draws down a subscription allowance.

Sources: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents), [environment variables](https://code.claude.com/docs/en/env-vars), [model configuration](https://code.claude.com/docs/en/model-config), [fast mode](https://code.claude.com/docs/en/fast-mode), [costs](https://code.claude.com/docs/en/costs), [usage limits](https://code.claude.com/docs/en/errors), [worktrees](https://code.claude.com/docs/en/worktrees), [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging), [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Cursor subagents](https://cursor.com/docs/subagents).
