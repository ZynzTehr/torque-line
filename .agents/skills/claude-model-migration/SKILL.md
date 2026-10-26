---
name: claude-model-migration
description: Move an application's prompts and Claude API calls to a newer Claude model, such as from a Claude 4 model to Claude Opus 5.5, Sonnet 5.5, or Fable 5.1. Use when the user wants to upgrade, switch, or compare Claude models in code, configuration, or prompts. Checks each API detail against Anthropic's current documentation instead of assuming it.
metadata:
  source: original
  status: stable
  reviewed: 2026-10-05
---

# Migrate to a newer Claude model

The goal is an application that runs on the target model, passes its own checks at least as well as before, costs a known amount, and can fall back to a working model.

## 1. Fix the target

Ask which model the user wants, or look it up in Anthropic's [models overview](https://platform.claude.com/docs/en/models/overview) and its guide to [choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model). In October 2026 the current models were Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1, and Claude Haiku 4.5, with the Claude API IDs `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1`, and `claude-haiku-4-5-20251001`. Amazon Bedrock, Google Cloud, and other platforms use their own IDs. Copy the ID for the user's platform from the overview instead of writing it from memory, and confirm that the target is available on that platform and account; the overview and the target's guide name requirements such as data-retention settings and tiers the model does not support.

Look up both models on the [deprecations page](https://platform.claude.com/docs/en/about-claude/model-deprecations). Requests to a retired model fail, so if the current model is retired, use recorded outputs and the existing tests as the baseline and choose an active model as the fallback. If the target is deprecated, tell the user its retirement date before migrating.

## 2. List what depends on the model

Search the code, configuration, and prompts before changing anything. Note:

- each model ID, the setting or environment variable that holds it, and the platform the code calls;
- every API call site, with its `max_tokens`, sampling parameters, stop sequences, tools and `tool_choice`, thinking or effort settings, beta headers, prompt caching, and batch use;
- code that reads responses by position, such as `content[0].text` or the first streamed content block, and stop-reason handling;
- conversation code: assistant prefills, tool-use loops, and anything that edits or rebuilds earlier turns;
- prompts written around an older model's habits;
- tests or evaluations that assert exact model output;
- token budgets and cost calculations.

## 3. Read what changed

Read Anthropic's [migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide) and any guide for the target model, such as the one for [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide), which has a checklist for each starting model. Check every item on your list against them and the API reference. A newer model can reject a setting an older one accepted, change a default, change the shape of a response, raise a limit, or cost a different amount. The Opus 5.5 guide, for example, says that model rejects non-default sampling parameters, assistant prefills, and forced tool choices, and that its responses can begin with thinking blocks, so code that reads the first content block as text breaks. Check [pricing](https://platform.claude.com/docs/en/about-claude/pricing) and record the date you checked.

In Claude Code, the built-in claude-api skill can apply many of these changes and list what to verify by hand: `/claude-api migrate this project to claude-opus-5-5`. Review its edits like any other change.

## 4. Change one place and keep a way back

Keep the model ID in one setting. Switch it there, apply the changes from step 3, and keep a fallback model ready until the checks pass.

## 5. Compare on the application's own work

Run the existing tests. Then send a fixed set of real requests through both models, or compare the target with recorded outputs if the current model is retired, and check:

- whether each answer meets the application's requirements, including its format or schema;
- tool calls, refusals, and answer length;
- latency, input and output tokens, and cost.

Prefer recorded fixtures or a small live budget the user has agreed to. Ask before spending beyond it.

## 6. Change prompts only where the comparison shows a problem

Edit one prompt at a time and rerun the same requests. Remove a workaround for an older model's habit only after the comparison shows the new model no longer needs it.

## 7. Roll out and record

Switch a small share of traffic or a non-critical path first, watch errors and cost, then finish the switch. Record the old and new IDs, the parameter and prompt changes, and the comparison results, so the next migration starts from evidence.

This skill does not choose a model for the user, change providers, or approve spending.
