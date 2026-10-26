---
trigger: always_on
---

# Git discipline

## Preserve work

Inspect the branch and working tree before writing. Keep unrelated user changes intact. Untracked and ignored files may contain the only copy of work; a merged branch, closed PR, or clean tracked diff does not make them disposable.

Destructive operations, force-pushing shared branches, and deleting worktrees require explicit user authorization covering the affected resources and potential loss. Existing authorization remains valid within its scope; apply [the autonomy policy](../autonomy-config.md). Prefer isolated worktrees to destructive recovery. Push to main or master only when explicitly requested.

## Commits and verification

Keep one logical change per commit; separate unrelated refactors, features, and fixes. Use imperative subjects under 72 characters and explain why in the body when needed. Keep secrets, local environment files, ignored files, and incidental build output out of commits.

Sequence work into independently understandable units and verify them when practical. Rebase local, unshared branches onto current trunk; respect the team's merge workflow for shared branches. Preserve both sides' intent during conflict resolution. If the intents cannot coexist, preserve the original work and obtain the missing decision. Run the required checks after resolving conflicts.

## Pull requests

Deliver small, focused PRs with the problem, resulting behavior, verification, and material risks. Follow the repository's template and the user's requested draft status. Preparing a PR does not authorize publishing or merging it; use the canonical autonomy policy. Report the actual branch, checks, and delivery state.
