---
trigger: model_decision
description: "Apply when initializing or scaffolding a project, or selecting its language, framework, and supporting tools."
---

# Project bootstrapping

## CONTEXT.md

Every project gets a `CONTEXT.md` at the root. This is the agent's memory across sessions. It answers: what is this, who is it for, and what decisions have been made.

Use the project's existing context document, or create `CONTEXT.md` early once product decisions are available. Aim for under 100 lines and link longer design or technology records. This is the canonical combined project context format. The domain-modeling skill maintains its domain terms section without replacing other sections.

### Required sections

```markdown
# [Project Name]

## What this is
One paragraph. What the project does, who it serves, what problem it solves.

## Stack
- Client and rendering: (chosen approach, or not applicable)
- Backend and language/runtime: (chosen approach, or not needed)
- Storage: (chosen approach, or not needed)
- Styling and assets: (when there is a UI)
- Deployment: (target and operating constraints)
- Toolchain: (actual package manager, build, lint, format, and test commands)

## Experience
- Audience and core task: (the primary user and outcome)
- Direction: (restrained, expressive, immersive, or the user's own description)
- Brief and acceptance: (link to DESIGN.md or the existing equivalent for substantial UI work)

## Domain terms
| Term | Meaning |
|------|---------|
| (term) | (plain English definition) |

## Key decisions
| Decision | Why | Date |
|----------|-----|------|
| (what was decided) | (why this over the alternatives) | (when) |

## Conventions
- File naming: (e.g., kebab-case for files, PascalCase for components)
- Folder structure: (brief description of where things live)
- Testing: (project-specific test conventions)
```

### Rules for maintaining CONTEXT.md

- Do not pad it with obvious information. "We use TypeScript because it has types" adds nothing.
- Record significant product, design, and technology choices with their reasons and accepted tradeoffs. Link longer comparisons when needed.
- Domain terms should use the language of the users, not the internals of the system.
- If documentation and code disagree, distinguish documented intent from current behavior. Correct proven documentation drift; report an implementation defect rather than silently rewriting the intended behavior to match it. Preserve unrelated sections and user decisions.
- Do not record progress or status here. A plan of record keeps it in the generated `PROGRESS.md`; CONTEXT.md holds decisions, not state.

## Project setup checklist

When starting a new project:
1. Resolve consequential missing scope and audience decisions with one interview skill. Reuse answers already given.
2. When technology is open, use [choose-stack](../skills/choose-stack/SKILL.md). For substantial UI work, start [creative-direction](../skills/creative-direction/SKILL.md) with the product brief. Let a bounded prototype settle uncertain technical needs before committing to a framework. The two decisions may inform each other.
3. Record the chosen stack and product decisions in `CONTEXT.md`, with a link to the experience brief when applicable.
4. Initialize only the required project structure and tools. Use the selected ecosystem's linting, formatting, dependency, and test commands. A static page or small script may not need a framework.
5. If agent configuration installation is part of the task, use `setup.sh` with the appropriate harness. See [HARNESS.md](../HARNESS.md); native skill discovery is optional.
6. Set up `.gitignore` before committing. Include the selected ecosystem's generated files, local environments, secrets, and OS metadata.
7. Verify a minimal runnable path before expanding the implementation. Keep setup separate from features when commits are part of the workflow.
