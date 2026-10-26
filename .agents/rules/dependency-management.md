---
trigger: model_decision
description: "Apply when installing, adding, updating, removing, or evaluating a dependency or package."
---

# Dependency management

## Before adding a dependency

1. **What gap does it fill?** Inspect the platform, framework, and existing dependencies first. A small, stable, project-specific transform may be cheaper to own than a package, but line count is not a correctness or safety test. Do not replace established cryptography, authentication, complex parsers, date/time handling, or accessible interaction primitives merely because a minimal version looks short.
2. **Can the project rely on it?** Check the documented support policy, compatibility, releases, issue handling, security response, and maintainer continuity. A mature package with infrequent commits can be healthy; recent activity or contributor count alone does not prove quality. Prefer vetted implementations for security-sensitive and accessibility-sensitive behavior, and verify that their actual configuration meets the need.
3. **What is its total cost?** Consider shipped client bytes where relevant, runtime and installation cost, transitive dependencies, license compatibility, operational requirements, and future upgrades. Use the project's actual build or ecosystem-appropriate inspection tools; package archive size is not browser bundle cost.

## When to add a dependency

- The problem is complex and well-solved by the library (cryptography, date math with timezones, image processing).
- The library's support and compatibility fit the project's expected lifetime.
- The license is compatible with the project.
- Its relevant runtime, bundle, and maintenance costs are proportional to its value.

## When to write it yourself

- Small string utilities, simple data transforms, and project-specific presentation with understood edge cases.
- Thin wrappers around the chosen platform's standard capabilities.
- Functionality where owning the implementation and its verification is simpler than integrating and maintaining the dependency. Assess behavior and upkeep, not just the initial code size.

## Lockfile discipline

- Follow the selected ecosystem's reproducibility convention. Commit the application's supported lockfile or equivalent pinned resolution metadata; honor documented differences for reusable libraries. Preserve exact resolutions and integrity metadata.
- Use the selected package manager's locked or frozen install mode in CI where supported. Discover the command from the project's scripts and current tool documentation; do not introduce npm into a non-npm project.
- Update intentionally in reviewable groups. Keep coupled compatibility changes together and verify affected behavior; avoid unrelated dependency churn.

## Auditing

- Run the project's ecosystem-appropriate dependency/advisory checks for changed packages. Prefer existing tooling; report an unavailable check and any limits in its coverage rather than claiming a clean audit.
- Investigate high/critical findings against the installed version and reachable behavior. Update, patch, replace, or remove affected dependencies where feasible; otherwise report the unresolved exposure and mitigation. Do not suppress a finding solely to make a check pass.
- Review relevant transitive dependencies, package provenance, and install/build scripts. A scan is evidence, not a guarantee of safety.

## Removal discipline

- When a dependency is no longer used, remove it. Dead dependencies accumulate security debt and confuse future maintainers.
- After removal, verify the build and test suite pass. Some dependencies have side effects or are implicitly relied upon.
