---
trigger: model_decision
description: "Apply when reviewing code, a pull request, a proposed change, or an engineering audit."
---

# Code review

## Review checklist

Work through each category in order. Flag issues by severity: **blocker** (must fix before merge), **concern** (should fix, could merge with a follow-up), **nit** (optional, style preference).

### 1. Correctness
- Does the code do what the spec, ticket, or user described?
- Are edge cases handled: empty inputs, null values, boundary conditions, concurrent access?
- Are error paths tested or at least considered?

### 2. Security
- No hardcoded secrets, API keys, or credentials.
- User input validated and sanitized at boundaries.
- No SQL injection, XSS, or path traversal vectors.
- Auth checks on every protected endpoint or operation.

### 3. Architecture
- Does the change respect the existing architecture? No lateral dependencies between modules that should be independent.
- Is business logic separated from framework wiring?
- Are new abstractions justified? Does this add a layer that earns its weight?
- Is anything duplicated that should be shared, or shared that should be independent?

### 4. Readability
- Can a new team member understand this code without the PR description?
- Are names descriptive? Variables, functions, types named by what they represent, not abbreviations.
- Is the control flow straightforward? Deeply nested conditionals or long function bodies signal a need to extract.
- Comments explain why, not what. If a comment restates the code, delete it.

### 5. Testing
- Are the critical paths covered by tests?
- Do tests assert behavior, not implementation?
- Are test names descriptive of what they verify?
- No snapshot tests on large objects without justification.

### 6. Performance
- Any new database queries? Check for N+1, missing indexes, unbounded results.
- Any new dependencies? Check bundle size impact.
- Any new loops or data processing? Check for O(n²) or worse on realistic input sizes.

### 7. Diff hygiene
- Is the change focused? Unrelated refactors, formatting changes, or feature additions should be separate commits or PRs.
- Are there debug artifacts left behind? `console.log`, `TODO`, `FIXME`, commented-out code.
- Does the commit history tell a coherent story?

## Delivering review feedback

- Lead with what the code does well. Acknowledge good patterns and thoughtful decisions.
- Be specific. "This could be better" is not actionable. "This handler swallows the database error on line 47, so failures will silently return undefined" is actionable.
- Suggest, don't command. "Consider extracting this into a named function" over "Extract this."
- Distinguish personal preference from objective issues. A nit is a nit.
- If the review is clean, say so briefly. Do not invent feedback to appear thorough.
