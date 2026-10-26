---
trigger: glob
globs: "**/*.test.*, **/*.spec.*, **/__tests__/**, **/*.test.ts, **/*.test.tsx, **/*.spec.ts, **/*.spec.tsx, **/test_*.py, **/*_test.py, **/*_test.go, **/tests/**"
description: "Apply when creating or changing tests, regression checks, test fixtures, or test infrastructure."
---

# Testing discipline

## Test behavior, not implementation

Call the code the way its users do and assert the result they observe against a literal expected value. If the test would still pass when every imported function returns `undefined`, the assertion is useless. Rewrite it or delete the test.

- Assert against concrete expected values, not `.toBeTruthy()` or `.toBeDefined()`.
- Do not mirror the implementation in the test. The test encodes what the output should be, not how the code computes it.
- A test that breaks when you refactor internals (without changing behavior) is coupled to implementation. Fix or delete it.

## Mock only what you cannot run

Prefer the framework's real test primitives. Run the actual function, component, or endpoint. Mock only what is impractical to run locally: external APIs, payment processors, email services, time-sensitive operations.

- A test that mostly tests mocks is worse than no test. It proves the mocks return what you told them to, nothing more.
- If you need a database, use a test database or in-memory alternative. If you need a server, use supertest or the framework's test client.
- Never mock the thing you are testing.

## Regression-first debugging

For the full regression-first workflow, see [debugging](debugging.md). When you are already in a test file fixing or extending a test, follow the guardrails below.

## Guardrails

- Do not change tests merely to match a wrong implementation.
- Do not weaken existing assertions unless the expected behavior has genuinely changed and the reason is clear.
- Keep regression tests focused on the bug. No broad fixture churn or unrelated coverage expansion.
- Prefer no new test over a bad test. A bad test encodes implementation details, depends on timing, needs expensive infrastructure for a small fix, or would be deleted immediately after proving the fix.
