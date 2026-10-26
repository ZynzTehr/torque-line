---
trigger: glob
globs: "**/api/**, **/server/**, **/routes/**, **/controllers/**, **/services/**, **/models/**, **/middleware/**, **/lib/**, **/utils/**, **/db/**, **/prisma/**, **/drizzle/**"
description: "Apply when creating or reviewing APIs, server logic, middleware, persistence, or shared backend utilities."
---

# Backend engineering

## Boundary discipline

Validation, parsing, and defensive error handling belong at system boundaries: incoming HTTP requests, CLI arguments, config files, external API responses, database results. Inside the system, trust the types.

- Parse untrusted raw data into validated domain values at the boundary, using the language's type and validation facilities.
- Do not re-validate deep in call chains. If the boundary already parsed it, the interior trusts the shape.
- Do not re-export transport, storage, or wire types through the public surface. The domain owns the types, the boundary translates.

## Business logic is pure

Business logic lives in pure functions with no framework, database, or HTTP dependencies. The framework shell is thin and mechanical: it calls the logic, it does not contain it.

- Can this be a pure function the shell just calls? If yes, extract it.
- Prompt construction, scoring, assessment, data transforms: all pure. State in, result out.
- Test the logic by calling the function, not by spinning up the server.

## Error propagation

- Return errors as values (Result types, discriminated unions) where practical. Reserve thrown exceptions for truly exceptional failures.
- Never swallow errors silently. Log with structured context (request id, user id, operation) or propagate.
- Error messages state what happened, what was expected, and what the caller can do. No "Something went wrong."

## API design

- Name endpoints by the resource, not the action. `POST /sessions` not `POST /login`.
- Return consistent response shapes. Every endpoint returns the same envelope or follows the same status-code contract.
- Validate request bodies with the project's language-appropriate schema or validation mechanism. Keep one source for the contract and derive runtime validation or static types where the tooling supports it; a static type annotation alone does not validate external data. Reuse established validators instead of maintaining competing schemas, types, and hand-written guards.
- Pagination, filtering, sorting: decide the convention once, apply it everywhere.

## Database interaction

- Migrations are forward-only, idempotent, and committed alongside the code that needs them.
- Queries live close to the data access layer, not scattered across route handlers.
- Use parameterized queries or the ORM's query builder. Never string-interpolate user input into SQL.
- Index the columns you filter and sort by. Measure query performance before optimizing.

## Structured logging

- Log structured JSON, not format strings. Include enough context to debug from a request id.
- No `console.log` in shipped code. Use the project's logger.
- Log at boundaries: incoming requests, outgoing calls, errors. Do not log inside tight loops or hot paths.
