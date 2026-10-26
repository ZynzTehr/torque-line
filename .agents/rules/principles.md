---
trigger: always_on
---

# Engineering principles

Inspect relevant code and actual state before choosing an approach. Find observable facts with tools rather than asking the user. Make uncertainty explicit.

Choose domain types and data structures before adding logic. Keep business logic independent of transport and storage; validate at boundaries. Make the smallest change that solves the requested problem. Simplify within that scope; avoid unrelated cleanup and speculative abstraction.

Sequence substantial work into units that end in a checkable state. For bugs, reproduce the symptom, trace its cause, and verify the fix on the original failing path. Related instances merit inspection, not automatic expansion of scope.

## Verification contract

Discover the project's actual build, lint, and test commands. Run the checks relevant to the change and any required project gates. Exercise the changed feature on the real artifact: input through output, including integration boundaries. For UI changes, inspect the rendered interface and affected interactions in a browser when available. Report an unavailable check instead of claiming it passed.

Check delegated work against files and behavior, not only a completion summary. Keep a repeatable verification command when it materially helps a reviewer. Explain what changed, why, the evidence, and remaining limits.

Design work should fit the product, preserve accessibility, and deliver polished behavior. Communicate with concise, concrete language.
