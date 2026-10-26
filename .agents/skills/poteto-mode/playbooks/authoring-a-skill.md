### Authoring or modifying a skill

**You own the skill's voice.**

1. Use the bundled [writing-for-agents](../../writing-for-agents/SKILL.md) guidance and an available skill-authoring helper when useful. Apply [HARNESS.md](../../../HARNESS.md) fallbacks when native skill tooling is absent.
2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR** only when PR delivery is in the user's authorized task; otherwise deliver the verified local changes.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
