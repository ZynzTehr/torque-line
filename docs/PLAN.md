# FleetPulse — Hosted Platform and Driver App Plan

Date: 2026-10-26  
Status: Proposed delivery plan; no implementation, deployment, or test run is represented by this document.  
Companion: [SPEC.md](./SPEC.md) defines the technical and permission contracts.

## 1. Direction

Evolve the existing FleetPulse into a shared fleet-maintenance platform with:

- A React Native + Expo app for drivers using iPhone and Android.
- The existing web dashboard, adapted for fleet owners and fleet administrators and usable on phones.
- One authenticated TypeScript API, PostgreSQL database, and private document store shared by both clients.
- Fleet-scoped permissions, equipment assignments, an approval inbox, and an audit history.
- Offline capture for driver submissions, with visible upload and review states.

Preserve FleetPulse's trucking-specific calculations, equipment model, maintenance schedules, fuel accounting, and human review of AI suggestions. Introduce the server before replacing screens. React Native is a new mobile interface, not a replacement for the backend or permission system.

This is a separate project from the guitar-to-tab app. The guitar app's three-day deadline does not apply here.

## 2. Existing foundation

Source baseline reviewed: [`ZynzTehr/fleet-pulse`, commit `88e9f01537774915d068afb56d81cf05534e2536`](https://github.com/ZynzTehr/fleet-pulse/tree/88e9f01537774915d068afb56d81cf05534e2536).

The repository currently uses Vite, browser JavaScript, and IndexedDB through `idb`. Equipment, maintenance schedules, service records, fuel, permits, insurance, and settings already have storage functions. Local equipment IDs auto-increment, and unit numbers are unique within the browser database. Gemini requests are made from browser code. These are source observations, not verification that the deployed app or its tests currently work.

Useful migration seams:

- [`src/js/data/db.js`](https://github.com/ZynzTehr/fleet-pulse/blob/88e9f01537774915d068afb56d81cf05534e2536/src/js/data/db.js): replace direct browser persistence calls with an API-backed adapter for hosted mode.
- [`src/js/services/`](https://github.com/ZynzTehr/fleet-pulse/tree/88e9f01537774915d068afb56d81cf05534e2536/src/js/services): extract suitable pure calculations and validation into shared packages.
- [`src/js/services/ai.js`](https://github.com/ZynzTehr/fleet-pulse/blob/88e9f01537774915d068afb56d81cf05534e2536/src/js/services/ai.js): move provider calls, credentials, and quotas behind the API.
- Existing import/reconciliation behavior: retain preview-before-commit, but replace local-ID assumptions with fleet-scoped UUID mappings.

Do not begin with a simultaneous rewrite of the web interface, mobile interface, data model, and AI features.

## 3. Product scope

### First working slice

One owner creates a fleet and invites two drivers. The owner adds equipment and assigns a truck to each driver. Each driver sees assigned equipment, submits an odometer/hour reading, photographs a receipt, or reports an issue. The owner reviews submissions on another device. A second test fleet cannot access any of the first fleet's information.

This slice proves the largest architectural changes before migrating every existing module.

### Pilot release

Required:

- Login, invitations, membership suspension, equipment assignment, and owner transfer.
- Driver, fleet administrator, fleet owner, platform support, and super-administrator boundaries.
- Driver app: My equipment, Update reading, Add receipt, Report issue, submission history, sync state.
- Web: equipment, schedules, maintenance history, fuel, submission review, membership management, audit history.
- Hosted permits and insurance records with appropriately restricted documents and financial fields.
- Local capture and retry of driver submissions and photos during loss of connectivity.
- Previewed migration of legacy JSON exports, preserving relationships and identifying duplicates/conflicts.
- Server-side optional OCR/AI with explicit review, quotas, timeouts, and no automatic authoritative changes.
- Server-side maintenance reminders plus in-app alerts; push is best effort.
- Staging, backups, restore rehearsal, error monitoring, and automated authorization tests.

Deferred:

- Billing automation and subscription plans; reserve owner-only billing permissions without implementing payments.
- GPS tracking, ELD/telematics integrations, dispatch, payroll, and route optimization.
- A claim that FleetPulse certifies regulatory compliance or that equipment is safe to operate.
- Continuous background sync, offline administrator editing, and automatic conflict resolution of business records.
- A configurable permission-builder UI, custom roles, and mechanic/dispatcher/accountant roles.
- Full React rewrite of the web dashboard, guaranteed universal UI sharing, and a native desktop app.

Fleet administration initially uses a fixed operational role. If a customer needs financial segregation, design and test a separate capability before granting access; do not pretend an unimplemented finance permission exists.

## 4. Architecture and choices

```text
Expo driver app                         Existing Vite web dashboard
  native screens / camera                 browser interface / owner workflows
  SQLite cache + durable outbox           hosted API adapter
  app-private queued photos               online writes initially
             \                              /
              HTTPS + authenticated API
               TypeScript / Fastify
         identity verification + fleet permissions
             /              |             \
     PostgreSQL        private object      background worker
     Prisma + RLS      storage             OCR / reminders / cleanup
     records/audit                         PostgreSQL job queue
```

Proposed default stack: TypeScript, Fastify, Prisma, PostgreSQL, an OIDC-compatible managed identity provider, private S3-compatible storage, and a Node worker. The cloud vendors and identity provider are selection gates, not provisioned resources. Redis is unnecessary for the first pilot; database-backed jobs are sufficient if claiming and recovery are implemented properly.

Use a small monorepo when implementation begins: `apps/web`, `apps/mobile`, `apps/api`, `apps/worker`, and packages for domain rules, API contracts, and the typed client. Avoid sharing browser DOM code with React Native. Keep existing web pages working while replacing their data adapter module by module.

Two important boundaries:

1. PostgreSQL holds authoritative fleet records. SQLite/IndexedDB are local caches or capture queues, never proof of permission.
2. Fleet roles apply inside a fleet. Platform support and super-administrator roles are separate, strongly authenticated, and audited.

## 5. Access model

| Role | Intended access |
| --- | --- |
| Driver | Assigned equipment and relevant maintenance status; own submissions; approved operational documents explicitly shared with drivers |
| Fleet administrator | Fleet equipment, schedules, fuel/service records, submissions, permits and insurance; invite/manage drivers and assignments; no ownership transfer or administrator promotion |
| Fleet owner | All fleet operations; administrator appointments; exports, fleet deletion, ownership transfer, future billing controls |
| Platform support | Account metadata and support workflows; no automatic access to fleet business records |
| Super administrator | Platform privilege administration and exceptional recovery through reasoned, time-limited, logged access |

One user can have different memberships in different fleets. Driver assignment is checked in addition to role. Fleet A's owner has no rights in Fleet B. Drivers must not receive full insurance premiums or fleet-wide financial records through broad API responses.

Owner transfer is an explicit transaction to an active fleet administrator with recent strong authentication. The last owner cannot simply be removed. The detailed permission matrix and support-access procedure are in SPEC.md.

## 6. Phased delivery and estimated effort

Planning assumption: one experienced developer, approximately 30 focused implementation hours per week, access to physical iPhone/Android test devices, and managed cloud services. Estimate **7–10 weeks for a controlled pilot**, roughly 210–300 focused hours. This includes integration, security, migration, and device testing. It excludes unpredictable store review delays, major redesigns, and substantial pre-existing defects. Re-estimate after the first working slice.

### Phase 0 — baseline and technical spikes (2–3 days)

- Run existing tests/build and record results without assuming README claims remain current.
- Inventory stored fields, photos/documents, export variants, and calculation edge cases.
- Confirm whether pilot fleets need a distinct finance-restricted manager role; otherwise use the fixed fleet-admin scope.
- Choose identity provider, hosting region, managed PostgreSQL, private storage, and release distribution.
- Prove Expo camera, durable local submission storage, secure token storage, and both platform builds on real devices.
- Prove Prisma transactions and PostgreSQL row-security context with the chosen connection pool.

Exit gate: reproducible baseline and working authentication/device/storage spikes; incompatible library versions resolved and pinned.

### Phase 1 — shared backend and isolated fleets (week 1–2)

- Add schema migrations for users, fleets, memberships, invitations, equipment, assignments, submissions, audit and idempotency records.
- Implement authentication and fixed permission policies; deny unknown actions by default.
- Establish tenant-scoped repository operations and tested RLS policies.
- Add API contracts, error envelopes, optimistic concurrency and transactional audit writes.
- Add a narrow owner onboarding flow and invitation acceptance.
- Add the hosted web data adapter for equipment; keep local demo mode isolated.

Exit gate: two users share one fleet's equipment across devices, and a second fleet cannot access it through any tested route or storage URL.

### Phase 2 — driver app and approval path (week 3–4)

- Implement the four primary driver actions with large touch targets and short forms.
- Implement reading/fuel/issue submissions, attachment staging, manager review and explicit decisions.
- Record readings as history; corrections remain traceable instead of overwriting old evidence.
- Use SQLite plus a durable outbox and local photo copies; add visible pending/rejected/conflict states.
- Retry safely after network loss, process restart and token refresh; recheck current assignment on the server.
- Show last synchronized time and reading freshness. Test shared-device logout/account switching.

Exit gate: owner and two drivers complete the first working slice, including a queued receipt surviving app termination and a revoked driver being denied on reconnect.

### Phase 3 — migration and existing modules (week 5–6)

- Add server tables/endpoints for schedules, service, fuel stop lines, permits and insurance.
- Preserve current domain rules and test real regression fixtures for date/mileage/hour triggers.
- Build legacy-export sanitization, dry-run report, UUID relationship mapping, and all-or-nothing commit.
- Move provider calls to server-side jobs; do not migrate browser API keys or secrets.
- Add object retention, scan/validation and protected download behavior.
- Add server reminder evaluation, in-app notifications and optional push delivery.

Exit gate: a representative legacy fleet imports without broken references or incorrect spend totals; rerunning the same import does not duplicate records; hosted workflows replace the selected legacy modules.

### Phase 4 — hardening and controlled release (week 7–8, reserve through week 10)

- Complete tenant/role/assignment and object-download denial tests.
- Run concurrency, idempotency, worker crash/retry and offline-sync interruption tests.
- Rehearse backups, restoration, import rollback and staged rollout rollback.
- Test app builds on physical iPhone and Android devices with poor service, denied camera permission and expired sessions.
- Set alerting and operational limits, verify cost assumptions, document support procedures.
- Release to a small invited pilot; fix findings before store/public expansion.

Exit gate: all required acceptance cases pass, known limitations are visible, and at least one real restore rehearsal succeeds. If security or data-integrity gates fail, postpone broader rollout.

## 7. Migration strategy

Do not erase browser data when users log in. Browser storage is isolated by device, browser profile, and origin; the server cannot discover and import all existing copies automatically.

1. Export each source database and keep the original backup safely.
2. Decrypt encrypted backups locally if needed. Create a sanitized migration payload that excludes API keys and local-only settings.
3. Owner chooses the target fleet and source namespace. Upload the sanitized payload for a dry run.
4. Report row counts, orphan references, duplicate unit numbers, units/currencies, date issues, suspicious readings, and potential duplicate service/fuel entries.
5. Resolve ambiguous mappings explicitly. Map legacy numeric IDs to UUIDs inside that source namespace.
6. Commit the approved manifest transactionally only if the fleet revision still matches the preview.
7. Reconcile totals/counts against the source, verify attachments, and mark the source migrated.
8. Freeze the old source as a legacy archive for the pilot. Do not accept simultaneous unsynchronized legacy edits as hosted changes.

Initial bulk import is limited to an empty fleet; a migration from additional devices into an existing fleet requires the explicit merge/conflict path. The old “Replace All Data” local restore must never become a broad hosted endpoint.

## 8. Offline contract

- Capture remains usable for previously verified assigned equipment within the offline permission window.
- Each action receives a stable UUID before being written to local storage; its submission and photo references enter one local transaction.
- UI distinguishes “Saved on this phone,” “Uploading,” “Awaiting review,” “Approved,” “Needs attention,” and “Rejected.”
- Foreground/resume sync is required; background sync is opportunistic. The operating system decides when background work runs. [Expo background tasks](https://docs.expo.dev/versions/latest/sdk/background-task/).
- The server revalidates membership and assignment at upload time. Old cached permissions do not authorize a write.
- Revocation cannot instantly remove data from a disconnected phone. Minimize cached information, use an offline window and protect the device. On denial, remove revoked server projections and freeze unsent local evidence for explicit resolution/discard; confirmed logout removes the account cache and files after the pending-work decision.
- Conflicting readings remain separate evidence; managers review stale/regressive readings and corrections. Never use silent last-write-wins for financial or maintenance history.

The pilot supports offline driver capture, not offline owner/admin editing. Camera capture works offline; cloud OCR waits for connectivity.

## 9. Test and release gates

Required evidence:

- Baseline build/tests and domain regression suite recorded.
- Parameterized denial tests cover each role across reads, writes, export, imports, attachments, AI and background jobs.
- Fleet A cannot attach, query, update or download Fleet B's resources, including through nested IDs and pagination/sync.
- Two devices submitting/retrying the same operation create one submission and one approved business effect.
- Concurrent edits and approvals reject stale revisions; failed transactions do not leave partial audit/history updates.
- Offline submission plus photo survives app restart and uploads once after reconnect.
- Driver removal/assignment changes are enforced before accepting queued work.
- Legacy import preserves relationships, units, money totals and original provenance; API keys are excluded.
- Owner transfer, support access expiry, cache partitioning and logout are tested.
- Failed worker claims recover; OCR cannot auto-save an authoritative reading or service interval.
- Backup restoration and tenant-scoped rollback are demonstrated on staging.
- iOS and Android release builds pass core workflows on physical devices, not only Expo Go or simulators.

Proposed pilot usability target: once logged in, submit a reading in no more than three primary actions; clearly show whether it is local, uploaded, or approved. Proposed server target: p95 ordinary record reads/writes below 500 ms under a documented 25-concurrent-user pilot workload, excluding media transfer/OCR. These are unmeasured targets.

## 10. Main risks and responses

| Risk | Response |
| --- | --- |
| Mobile rewrite expands | Build only driver workflows first; reuse domain logic, not DOM components |
| Tenant leak or role escalation | Central policies, RLS, composite tenant keys, no privileged runtime database role, negative tests |
| Offline duplicate/conflicting data | Durable operation IDs, server idempotency, append-only submissions, revision checks |
| Legacy ID collisions | Source-specific mappings, fleet-specific unit uniqueness, preview before import |
| Receipts upload partially | Private staged objects, checksums, finalization, bounded retries and orphan cleanup |
| Odometer rollback/replacement | Reading history, reported vs received times, explicit manager correction and reason |
| AI/provider outage or expense | Optional jobs, budgets, deadlines, manual entry, no browser secrets |
| Background work does not run | Foreground retry and clear pending status; no “always synced” claim |
| App-store/account delays | Test distribution first; mobile web remains available for owner workflows |
| Scope exceeds estimate | Pilot gates first; defer billing, telematics, custom roles and broad UI rewrite |

## 11. Operating and handoff requirements

Separate development, staging and production databases, storage and identity configuration. Use only synthetic/redacted data in development. Production secrets belong in a managed secret store and never in mobile builds, browser bundles or exports. Require MFA for fleet owners/admins and platform operators; review the provider's supported assurance enforcement during Phase 0.

Document the supported OS/device matrix, package lockfiles, database migration commands, storage configuration, authorization matrix, recovery runbook, data retention and account offboarding. Collect logs with request, fleet, operation and job IDs without receipt contents or credentials. Agree on costs and retention before public release; no vendors have been purchased or provisioned by this plan.

Handoff checklist:

- [ ] API contracts, database migrations and permission fixtures are versioned.
- [ ] All required pilot acceptance checks pass with recorded evidence.
- [ ] Test device builds and staging URLs are available to the pilot team.
- [ ] Existing data remains backed up and migration reconciliation is signed off by the fleet owner.
- [ ] Backup/restore, worker retry, membership revocation and incident procedures are rehearsed.
- [ ] Known limitations, costs, support ownership and deferred features are explicit.

## 12. References and assumptions

Source-linked observations refer to the repository baseline above. Architecture, schedule, quotas and release thresholds are proposed decisions. Reconfirm them during implementation.

- [React Native security](https://reactnative.dev/docs/security)
- [Expo camera](https://docs.expo.dev/versions/latest/sdk/camera/), [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [OWASP multi-tenant security](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OAuth for native apps, RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252)
