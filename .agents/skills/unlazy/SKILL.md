---
name: unlazy
description: Enforces completion discipline for substantial autonomous work by writing acceptance gates before execution, decomposing work with the Depth Tree, running checks, and verifying evidence before reporting. Use for /unlazy, "unlazy", "gates", "depth tree", "do not stop until it is done", or multi-part complex builds.
license: MIT
metadata:
  source: original
  status: stable
  reviewed: 2026-10-07
---

# Unlazy

Make incomplete work visible and make completion testable. Prove outcomes against an explicit acceptance ledger rather than relying on a self-reported completion summary.

## The execution protocol

### 1. Write gates before real work
Before modifying code or implementing features, define acceptance criteria in a structured gates ledger:
- Define one observable, verifiable outcome per gate.
- Specify exact verification commands (`CHECK:`) and expected outputs (`EXPECT:`).
- For manual evaluations, define clear non-ambiguous acceptance criteria.

Example gate definition:
```markdown
### GATE-1: Auth middleware rejects expired token
CHECK: npm test tests/auth.test.ts -- -t "expired token"
EXPECT: 1 passed
```

### 2. Decompose work with the Depth Tree
For complex, multi-part projects, decompose tasks into a strict hierarchy:
- **L0 (Root):** Overall deliverable objective.
- **L1 (Subsystems):** Independent modules, services, or packages.
- **L2 (Components):** Specific files, routes, or functional units.
- **L3 (Leaf tasks):** Discrete, checkable changes ending in a green gate.

Never skip levels. A leaf task must be small enough to complete and verify within a single step.

### 3. Verify evidence before reporting
- A gate is only satisfied when its `CHECK:` command executes, exits with status 0, and matches `EXPECT:`.
- Self-attestation or confident completion claims without command evidence do not satisfy a gate.
- If a gate cannot be satisfied due to an external constraint, record an explicit abandonment reason rather than silently deleting the check.

### 4. Continuous progress loop
Work through gates sequentially. After each leaf implementation:
1. Run the gate verification command.
2. Confirm expected behavior.
3. Record the result in the ledger.
4. Advance to the next gate without stopping until all gates pass.
