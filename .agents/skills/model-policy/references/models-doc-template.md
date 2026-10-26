# Template for docs/agents/models.md

The model-policy skill writes `docs/agents/models.md` from the block below, beside `docs/agents/issue-tracker.md`. Replace every angle-bracket placeholder and delete the column of a harness the project does not use. The ticket-graph coordinator and the workstreams skill read the Roles table, and the first word of each cell is the agent name they spawn, so keep that shape.

```markdown
# Models per subagent role

Level: <unlimited | large | medium | small>, set by the model-policy skill on <YYYY-MM-DD>. Re-run the skill to change it.

The implement skill's ticket-graph coordinator and the workstreams skill spawn the roles below by the agent names in this table. A role marked none falls back to the harness's general delegate on the main session's model. Design, coordination and integration stay in the main session on its own model.

## Roles

| Role | Claude Code | Codex | Cursor |
|---|---|---|---|
| explorer | explorer (<alias>, effort <value>) | explorer (<slug>, effort <value>) | explorer (<slug or inherit>) |
| implementer | implementer (<alias>, effort <value>) | implementer (<slug>, effort <value>) | implementer (<slug or inherit>) |
| reviewer | reviewer (<alias>, effort <value>) | reviewer (<slug>, effort <value>) | reviewer (<slug or inherit>) |
| merger | merger (<alias>, effort <value>) | merger (<slug>, effort <value>) | merger (<slug or inherit>) |
| built-in Explore override | Explore (haiku) <or none at the unlimited level> | none | none |

## Where each definition lives

| Harness | Folder | Files |
|---|---|---|
| Claude Code | `.claude/agents/` | `explorer.md`, `implementer.md`, `reviewer.md`, `merger.md`, `explore.md` (the Explore override) |
| Codex | `.codex/agents/` | `explorer.toml`, `implementer.toml`, `reviewer.toml`, `merger.toml` |
| Cursor | `.cursor/agents/` | `explorer.md`, `implementer.md`, `reviewer.md`, `merger.md` |

Subagent model variable: <CLAUDE_CODE_SUBAGENT_MODEL=<alias> in the env block of .claude/settings.json, added on <YYYY-MM-DD> after the user's yes | not set>.

Verified: <YYYY-MM-DD and the model seen in the subagent transcript header or task card | not yet verified>.

## Change or remove

- To change the level or a model, re-run the model-policy skill. It rewrites the files above in place and updates this document.
- To change one role by hand, edit the model or effort line in its definition and the matching cell here. A Codex or Cursor model ID must be one your account offers.
- To remove a role, delete its definition file and mark its cell none; the coordinator then uses the general delegate for that role.
- To remove the policy, delete the definition files listed above, remove `CLAUDE_CODE_SUBAGENT_MODEL` from `.claude/settings.json` if it was added, and delete this document.
```
