---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea, optionally recording settled decisions as project docs. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
license: MIT
metadata:
  source: https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling
  changes: modified
  status: stable
  reviewed: 2026-10-04
---

Resolve the product decisions needed for the requested work. When the user explicitly requests a deep interview, map the relevant decisions as a **design tree** and explore it in rounds. During ordinary project setup, keep the interview short enough to reach a useful prototype or implementation step.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled. Ask a small batch of consequential questions, with a recommendation and tradeoff for each. Skip answered questions. Ordinary reversible implementation choices can use stated assumptions; required preferences, approvals, or hard constraints need an answer before dependent work proceeds.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Find observable facts in the project or primary documentation. Delegate independent research when useful and available. Ask the user about goals and preferences that materially affect the result. Continue independent work while a necessary answer is pending; silence is not consent.

When the user wants decisions recorded as they settle, keep the project's `CONTEXT.md` and ADRs current through [domain-modeling](../domain-modeling/SKILL.md) during the interview. Otherwise save nothing.

Finish when the next authorized step is clear, summarizing settled decisions, assumptions, and remaining uncertainties. Do not require an extra confirmation for already authorized work. If the user asked for an interview only or a checkpoint, stop there. Use [choose-stack](../choose-stack/SKILL.md) for open technology decisions and [creative-direction](../creative-direction/SKILL.md) for substantial UI direction; load only the relevant workflow.
