# FleetPulse — Hosted Platform and Mobile Technical Specification

Date: 2026-10-26  
Status: Proposed contract for a controlled pilot; no implementation or measured results are claimed.  
Delivery plan: [PLAN.md](./PLAN.md).  
Source baseline: [`88e9f01537774915d068afb56d81cf05534e2536`](https://github.com/ZynzTehr/fleet-pulse/tree/88e9f01537774915d068afb56d81cf05534e2536).

## 1. Purpose and deployment boundary

Turn the existing browser-local maintenance tracker into a shared, authenticated fleet application. Drivers use a React Native + Expo phone app. Fleet owners and fleet administrators use the adapted Vite web dashboard, including from phones. Both use the same API and authoritative PostgreSQL records.

The initial pilot serves small fleets, approximately 5–25 power units each plus associated equipment, on a small invited deployment. It is not an ELD, dispatch system, live GPS tracker, accounting system, certified inspection system, or guarantee that a truck is safe/legal to operate. The guitar-to-tab application is outside this specification.

Required pilot capabilities: fleet isolation; fixed roles; invitations and assignments; reading/fuel/issue submissions; manager review; schedules, service, fuel, permits and insurance; offline driver capture; private attachments; auditable corrections; previewed legacy import; optional server-side AI; reminders; backup/recovery.

## 2. Architecture and code ownership

```text
apps/mobile: Expo / React Native / TypeScript
  camera + native navigation + local SQLite/outbox + secure credentials
apps/web: existing Vite app, progressively typed
  owner/admin workflows + hosted data adapter; online writes initially
                           │
apps/api: TypeScript / Fastify
  OIDC verification → membership → action + assignment policy → service
                           │
         Prisma / PostgreSQL / private object storage
                           │
apps/worker: Node.js
  leased database jobs → OCR, notifications, exports, retention
```

Shared packages: `contracts` (versioned request/response schemas), `domain` (pure calculations and validation), `api-client` (typed HTTP client). Do not import DOM/IndexedDB code into mobile or database/provider clients into either frontend. Existing HTML/CSS screens are not directly reusable native components.

The proposed API is a modular monolith. Use one deployment per API/worker role initially, not microservices. PostgreSQL holds durable jobs, so Redis is not required for the pilot. Prisma migrations own schema changes, including reviewed SQL for RLS, partial indexes and constraints.

Cloud provider, identity provider, object store and specific compatible package versions are Phase-0 selection gates. No resource creation or paid subscription is authorized by these documents. Pin the selected Expo SDK, native build configuration, Node LTS, Fastify, Prisma and PostgreSQL versions after compatibility spikes.

## 3. Identity, fleets and privileges

### 3.1 Authentication

Use an OIDC-compatible managed identity service; do not build password storage. Validate issuer, audience, signature, expiry and permitted algorithms. Identity is keyed by `(issuer, subject)`, not email alone. Verified email is used for invitation matching.

Mobile uses authorization code + PKCE through the system browser with registered redirect/deep-link verification and state/nonce validation. Do not embed a client secret. [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252).

Web uses a server-managed session in an HttpOnly, Secure, SameSite cookie; state-changing cookie-authenticated routes require CSRF protection and exact allowed Origin checks. Do not store web bearer tokens in localStorage. Mobile uses a short-lived access token in memory and the provider-approved secure refresh/session mechanism, storing durable credentials through native secure storage. Validate token revocation/session state according to provider capabilities; always check current application membership for business requests.

Require recent MFA/step-up for owner/admin/platform use, role promotion, owner transfer, fleet deletion, export and support-access grant. Authentication is online. Previously verified drivers may access the minimal offline cache under section 7; offline capture is not an identity-provider login bypass.

### 3.2 Tenant and role model

A fleet is the customer tenant. A user may have memberships in multiple fleets, with a different role in each. Exactly one active owner per fleet is the pilot invariant. Ownership transfer changes the current owner to fleet administrator and promotes one existing active fleet administrator atomically. Do not demote/suspend/delete the last owner through generic membership endpoints.

Fleet roles: `driver`, `fleet_admin`, `owner`. Platform roles are separate records: `support`, `super_admin`. A platform role alone never grants routine fleet-data access. No role/capability supplied in a client body or identity display profile can promote a user.

| Action | Driver | Fleet admin | Owner | Platform support / super admin |
| --- | --- | --- | --- | --- |
| View equipment and PM status | Currently assigned equipment only | Own fleet | Own fleet | Only through an explicit scoped support grant |
| Submit reading/fuel receipt/issue | Current assignment; own identity | Own fleet | Own fleet | No routine impersonated submission |
| View submissions | Own submissions while active fleet member | Fleet submissions | Fleet submissions | Grant-limited, normally read-only |
| Approve/reject submissions; correct records | No | Yes, audited | Yes, audited | No routine write grant |
| Manage schedules/equipment/service/fuel | No | Yes | Yes | Explicit exceptional workflow only |
| View insurance premiums/fleet financial data | No | Yes in this fixed pilot role | Yes | Excluded from default support grants |
| Read operational documents | Explicitly driver-visible and assigned | Fleet documents | Fleet documents | Grant must include document access explicitly |
| Invite/manage drivers and assignments | No | Yes | Yes | Account support does not confer fleet membership |
| Appoint/remove fleet admins | No | No | Yes | Audited emergency recovery only |
| Export/import fleet or delete fleet | No | No | Yes with step-up | Separate exceptional recovery policy |
| Transfer ownership | No | Cannot initiate | Yes with step-up | Exceptional recovery only |
| Appoint platform operators | No | No | No | Super admin with step-up and audit |

Fleet-admin is an operational role with financial visibility in the pilot. A restricted manager/finance split is a later capability design, unless identified as a pilot requirement in Phase 0. Driver uploads of their own receipt amount do not entitle them to fleet-wide financial totals.

Invitations: owner can invite drivers/admins; fleet admin can invite drivers only. Store hashed one-use tokens, intended verified email, role, expiry and inviter. Default expiry seven days; revoke/resend explicitly. Accept only as the matching verified user. Owner creation is an authenticated onboarding transaction, not a role chosen on public sign-up. Platform roles are never invitation options.

### 3.3 Authorization enforcement

Every API/service action checks verified user, active membership, selected fleet, permitted action and relevant assignment/resource visibility. Unknown actions deny by default. Fleet IDs and equipment IDs in URLs are selectors, not permission evidence. Validate all parent-child relationships, including multiple equipment references in one fuel stop.

Tenant tables carry `fleet_id`; use composite foreign keys `(fleet_id, parent_id)` to prevent cross-fleet links. Unit-number uniqueness is `(fleet_id, normalized_unit_number)`, not global. Normalize whitespace/case with a documented function while preserving the display value.

Require PostgreSQL RLS on tenant-owned business tables before the pilot. Runtime API roles must not be superuser, table owner or `BYPASSRLS`. Use a separate migration owner. Establish fleet context transaction-locally on the same connection as the queries, never as a connection-pool session default; absence of context denies access. Test policies and pool reuse. Application policy still enforces role and assignment; RLS fleet isolation does not itself provide the complete permission matrix. [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

Global membership lookup uses a narrow repository operation limited to the authenticated user. A restricted queue dispatcher can claim operational job metadata across fleets; business reads/writes by the worker execute with the job's verified fleet context. Do not give the general API a broad RLS-bypass credential for convenience. Source: [OWASP tenant isolation](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html).

### 3.4 Support and super-administrator access

Support sees account status and operational health metadata by default. Owner-authorized support grants specify fleet, allowed read actions, reason/ticket and expiry ≤60 minutes; read-sensitive documents require an explicit grant. Recheck expiry for every request, display support-access activity to owners and audit reads under the grant. Never accept an arbitrary `asUser` header.

Super administrators can manage platform privileges and perform exceptional ownership recovery through a separate step-up protected endpoint with reason, bounded scope, owner notification, and independent review by another platform operator before execution. Bootstrap the first operator out of band. If only one operator exists, disable that emergency recovery route until review can be provided. Do not implement a hidden “view/edit all fleets” mode.

## 4. Driver and owner workflows

### 4.1 Driver app

Primary navigation: My equipment, Add reading, Add receipt, Report issue, Activity. An owner/admin account may use the driver actions for its fleet, but administration initially links to the web dashboard.

Show unit number, equipment type, last accepted reading, freshness/last-sync time and relevant PM status. Stale/missing data is “Needs update” or “Unknown,” not automatically healthy. No continuous location permission is required. Ask for camera/photo permission only when needed and allow manual entry/photo-library selection if appropriate.

Reading form: equipment, odometer or hours, unit of measure, observed time, optional photo/note. Fuel form: one stop, date/station, diesel/DEF/reefer lines, assigned equipment, quantities/prices/totals and optional receipt. Issue form: equipment, category, description, severity selected by user and up to five photos. An issue report does not itself certify an inspection or authorize operation.

User explicitly confirms capture. App first persists the action locally, then uploads when possible. Local save, server acceptance, and manager approval are different visible states.

### 4.2 Submission review

Drivers create submissions, not direct authoritative service/financial changes. Server accepts an immutable original payload into `pending_review`. Manager sees origin, submitter, observed/received times, photos and validation warnings. Approve or reject with a reason; approval may include corrected fields while retaining original payload and correction explanation.

Approval atomically creates the authoritative reading/fuel/issue effect, records a decision and audit event, increments affected revisions and marks the submission resolved. A unique source-submission constraint prevents a second business effect. Rejecting does not erase original evidence. A driver can create a corrected replacement referencing the rejected submission; it has a new operation ID. Issue submissions are visible immediately in the manager inbox, prioritized by reported severity, before approval; review must not hide unapproved reports.

No self-approval: administrators/owners submitting through the driver flow require another authorized reviewer. If a fleet has only one authorized manager, that user can instead enter an explicit direct administrative record, with a reason and full audit; it is labeled direct entry, not independently approved.

### 4.3 Business rules retained and clarified

- Equipment: tractors, trailers, reefers, unit-number identity and optional VIN/engine metadata; archive rather than cascading away history.
- PM: preserve configured mileage/calendar “whichever first” behavior. Hour-based reefer schedules must be modeled/tested explicitly; do not infer them from tractor mileage fields.
- Readings: immutable observations with corrections/replacement events. Lower or implausibly future readings require review. Engine replacement/odometer rollover starts an explicit new meter epoch with reason; it is not a silent decrease. Within an epoch, order non-superseded accepted observations by `(observedAt, receivedAt, id)` and use the latest as the current projection. Approving older evidence does not roll back that projection. Validate a new reading against the current epoch/projection under lock; a regression requires an explicit correction/epoch transition and reason. Preserve the original unit/value and a normalized comparison value.
- Service: duplicate detection uses normalized service/date/equipment warnings; legitimate multiple services on the same visit remain possible.
- Fuel: one stop may have multiple products/equipment; allocate each line once and count stop total once. Preserve currency/units; use decimal money values or minor units, never binary float as the accounting representation.
- Permit/insurance: fleet and optional equipment association, dates, jurisdiction/carrier metadata, renewal status and private attachments. Drivers receive only allowlisted operational fields/documents.
- AI: extracted values and suggested intervals always require human confirmation. Record provider/model and acceptance provenance; detector confidence is not proof of correctness.

## 5. Persistent data model

Use UUIDs for hosted and mobile-generated IDs, UTC lifecycle timestamps, explicit date-only values for business dates, a fleet IANA timezone for calendar calculations, integer revisions, and soft archive/deletion where historical links exist. Observed timestamps are user/device assertions; `received_at` is server time. Validate extreme clock skew and flag it for review. Store distance/hour units explicitly; do not silently convert imports without showing the conversion.

| Entity | Required fields and relationships |
| --- | --- |
| `User` | ID, issuer, subject, verified email, display name, account status; unique issuer/subject |
| `Fleet` | ID, name, timezone, default currency/measurement settings, owner membership reference, revision, lifecycle state |
| `Membership` | ID, fleet ID, user ID, role, active/suspended status, authz revision, timestamps; unique fleet/user |
| `Invitation` | Fleet, verified-email target, proposed role, token hash, expiry, inviter, accepted/revoked timestamps |
| `Equipment` | Fleet, UUID, unit number/normalized unit number, type, VIN/engine metadata, canonical reading projection, revision, archived timestamp |
| `Assignment` | Fleet, membership, equipment, effective start/end, revision; prevent duplicate active assignment pairs; equipment may have multiple authorized drivers |
| `Submission` | Fleet, UUID/operation ID, membership/user, equipment references, kind, schema version, immutable original payload, observed/received times, status, revision, replacement link |
| `SubmissionDecision` | Submission, reviewer, decision, corrected payload if any, reason, timestamp; unique terminal decision per submission |
| `ReadingObservation` | Equipment, reading type, decimal value/unit, observed/received times, source submission or direct-entry actor, correction/supersession link, reason |
| `MaintenanceSchedule` | Equipment, category, enabled, distance/hour/calendar interval fields and baseline service linkage, revision |
| `ServiceRecord` | Equipment, service date/type, reading/unit, decimal cost/currency, shop, note, author, revision, void/correction provenance |
| `FuelStop` / `FuelLine` | Stop date/station/receipt/currency/total; product/equipment/quantity/unit/price/subtotal per line; source submission unique |
| `Issue` | Equipment, reporter, description/category/severity, open/acknowledged/resolved status, resolution note, revision |
| `Permit` / `InsurancePolicy` | Fleet, optional equipment, typed metadata, effective/expiry dates, financial fields, revision, archive state |
| `Attachment` | Fleet, uploader, generated storage key, checksum, bytes, detected MIME, validation/scan state, visibility, allowed parent link, retention timestamps |
| `Device` / `PushRegistration` | User, app installation ID, platform, token reference, last seen, revoked timestamp; authorize notification recipients again at send time |
| `IdempotencyRecord` | Fleet, actor, operation key, canonical request hash, response reference, created timestamp; unique scope/key |
| `AuditEvent` | Fleet where relevant, actor/platform grant, action, entity, request/operation IDs, field-level change summary, reason and server time; append-only runtime access |
| `ChangeEvent` | Fleet, monotonic change sequence, entity/revision, tombstone/visibility event, commit time; contains minimal metadata, not unrestricted record payload |
| `ImportBatch` / `LegacyIdMap` | Fleet, source namespace, checksum, preview revision, decisions, result manifest, original-ID→UUID mappings and created-record list |
| `Job` / `Notification` / `SupportGrant` | Durable job claims/results; deduplicated in-app notices; scoped audited platform access |

Enforce tenant foreign keys on child records and equipment references, not only at the API. A partial unique index permits at most one active owner membership per fleet; the non-null fleet owner reference and transactional onboarding/transfer enforce the required owner. Prevent concurrent removal of the last owner under a fleet row lock. Enforce valid enums, positive quantities, decimal precision, date bounds, attachment visibility, allowed parent links and bounded JSON sizes. Reading observations additionally carry a meter-epoch ID and normalized comparison unit/value.

All state-changing business transactions write audit and change records in the same database transaction. Audit does not contain secrets, full photos or unrestricted copied documents. Retain original/corrected financial and maintenance evidence; ordinary deletion is void/archive plus reason. Runtime code cannot update/delete audit history.

For the pilot change feed, serialize fleet-visible business writes by locking the fleet row before allocating that fleet's next sequence. This provides commit-ordered cursors without assuming ordinary PostgreSQL sequence values equal commit order. Keep transactions short; revisit this bottleneck only if measured traffic requires it.

## 6. HTTP contracts

Base `/api/v1`; HTTPS in deployed environments. JSON fields use camelCase; UUIDs are opaque identifiers. Validate request and response schemas, allowlisted writable fields and maximum bodies. Use cursor pagination with a maximum page size of 100. Do not accept `fleetId`, author or role from a writable body as authoritative when determined by path/session.

Errors:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "This record changed. Reload before applying your edit.",
    "retryable": false,
    "details": { "currentRevision": 6 }
  },
  "requestId": "uuid"
}
```

Status rules: 400 invalid shape, 401 invalid/expired authentication, 403 permitted resource but forbidden action, 404 absent or inaccessible cross-fleet resource, 409 stale revision/idempotency/decision conflict, 413 size limit, 415 unsupported media, 422 validated business-rule violation, 429 quota, 503 unavailable dependency. Do not reveal existence through cross-fleet error details. Return `Retry-After` for transient quota/dependency failures. Sensitive responses use `Cache-Control: no-store`.

### 6.1 Identity and administration

| Method/path | Contract |
| --- | --- |
| `GET /me` | User, current session assurance, active memberships with roles; no other users' memberships |
| `POST /fleets` | Authenticated onboarding `{name, timezone, defaultCurrency}`; creates fleet plus owner atomically |
| `GET /fleets/:fleetId` | Allowlisted fleet metadata and caller permissions |
| `POST /fleets/:fleetId/invitations` | `{email, role}`; owner/admin role restrictions; single-use invite; email sending requires configured transactional delivery |
| `POST /invitations/accept` | `{token}`; matching verified email, unexpired/unrevoked token, transactional membership creation |
| `PATCH /fleets/:fleetId/memberships/:id` | `{expectedRevision, status?, role?}`; owner/admin restrictions, revoke authz on change, last-owner protection |
| `POST /fleets/:fleetId/transfer-owner` | `{targetMembershipId, expectedFleetRevision}`; recent MFA; atomic transfer to active admin |
| `POST /fleets/:fleetId/assignments` | `{membershipId, equipmentId, startsAt, endsAt?}`; active same-fleet driver; audit change |
| `PATCH /fleets/:fleetId/assignments/:id` | `{expectedRevision, endsAt}`; end/revoke assignment, emit cache visibility change |
| `POST /me/devices` | Register installation/push token for current user; logout/revoke removes delivery authorization |

Invitation/notification email text must not contain unrestricted fleet records. Role changes and assignment changes become effective for new server requests immediately after commit; do not wait for a long-lived JWT's role claims to expire.

### 6.2 Equipment and business records

`GET/POST /fleets/:fleetId/equipment`, `GET/PATCH /fleets/:fleetId/equipment/:id`, and `POST .../:id/archive` implement the policy matrix. PATCH requires `expectedRevision`; server writes use a revision compare-and-swap. GET list is role/assignment filtered and excludes fleet financial fields for drivers.

Schedules, service records, fuel stops, permits, insurance and issues use `/fleets/:fleetId/{resource}` and `/{id}` with typed GET/POST/PATCH endpoints. Mutations require an idempotency key; edits require `expectedRevision`. Financial/service corrections and voids require a reason and preserve history. No generic arbitrary-table CRUD route. Driver requests to these management mutations deny access; they use submissions instead.

### 6.3 Driver submissions and review

`POST /fleets/:fleetId/submissions` requires `Idempotency-Key: <operation UUID>`.

```json
{
  "id": "operation-uuid",
  "schemaVersion": 1,
  "kind": "reading",
  "equipmentId": "equipment-uuid",
  "observedAt": "2026-10-26T16:00:00Z",
  "payload": { "readingType": "odometer", "value": "482150", "unit": "mi" },
  "attachmentIds": [],
  "deviceId": "installation-uuid"
}
```

201: `{submission: {id, status: "pending_review", revision: 0, receivedAt}, replayed: false}`. Same operation and canonical payload returns 200 with the same submission, `replayed: true`. Different payload with reused key returns 409 `IDEMPOTENCY_CONFLICT`. New effects require current assignment. An exact replay after an assignment ends may return the caller's original submission receipt while their fleet membership remains active, consistent with own-history access; it cannot create or change an effect. Suspended/removed membership denies even replay. UUID labels in examples stand for actual UUID values.

Other kinds: `fuel_stop` has one currency, stop metadata and ≤10 typed product lines with equipment IDs; `issue` has category, bounded description, severity and ≤5 photos. Per-kind JSON Schema is versioned; unknown kinds/fields fail validation. Client supplies no reviewer/status/author overrides.

`GET /fleets/:fleetId/submissions` lists own submissions for drivers and fleet submissions for managers; supports status/cursor filters. Drivers retain visibility of their own historical submissions while an active member even if the old truck assignment ends, but cannot reopen general equipment/history access through those references.

`POST /fleets/:fleetId/submissions/:id/decision` takes `{expectedRevision, decision: "approve|reject", reason, correctedPayload?}` and an idempotency key. Validate reviewer scope, no self-approval, unresolved status, current revision and typed corrections. Use one lock order throughout business writes: fleet first, then submission where relevant, then affected equipment rows in UUID order. Commit effect, decision, revisions, audit and change events together. Concurrent decisions produce one effect; the loser gets 409. Return decision and authoritative effect IDs. A rejected submission cannot later be silently flipped; a correction/replacement is a new linked workflow.

### 6.4 Attachments

`POST /fleets/:fleetId/attachments/intents` takes `{clientAttachmentId, equipmentId?, purpose, fileName, byteSize, sha256, declaredMime}` with idempotency. Check role, assignment, quota and same-fleet parent intention. Return attachment ID, a generated private key and a ≤5-minute upload authorization; never accept a user-chosen object key.

Upload to a staging object using the allowed method/size constraints. `POST /fleets/:fleetId/attachments/:id/finalize` verifies actual object size/checksum and schedules validation; client assertions are insufficient. File becomes usable only after detected-media/scan checks succeed. Return state `uploaded|validating|ready|rejected`. A submission references only ready same-fleet attachments uploaded by that actor or explicitly authorized for that parent.

Pilot bounds: JPEG/PNG for driver images, ≤10 MiB each after resizing, ≤5 images per submission. Owner/admin document upload additionally allows PDF ≤20 MiB; PDF previews/downloads require validation and are not executed as HTML. Use private buckets, restrictive CORS, generated keys, content-type sniffing, image decode/re-encode and malware checks for document uploads. Do not trust extension or allow SVG/HTML/executable documents. Quarantine files until checks complete.

`GET /fleets/:fleetId/attachments/:id/download` checks current parent visibility and streams through the API for business documents so authorization is checked on each request; avoid reusable public download URLs. Denied requests cannot reveal private key names. Large-object streaming must not buffer entire files. Range support may be implemented for PDFs. Short-lived upload authorizations may outlive revocation briefly, but finalization/submission must still deny and orphan cleanup removes unused objects.

### 6.5 Sync, imports, jobs and platform operations

- `GET /fleets/:fleetId/mobile-snapshot`: online-authorized minimal projection with assignments, operational equipment/status, own submissions, high-water cursor, server time and offline expiry. Materialize the bounded authorized projection and its high-water mark from one consistent database snapshot; store the expiring snapshot server-side and paginate that immutable projection with a user/fleet-bound token valid for ten minutes. Do not paginate changing live rows and assume a high-water cursor alone makes them consistent. Later changes arrive through the feed. Recheck membership/authz revision per page; invalidation requires restart, not mixed pages. Delete snapshot material after expiry.
- `GET /fleets/:fleetId/changes?cursor=...&limit=100`: authorized deltas/tombstones and next cursor. Cursors bind fleet, user and authz revision, are integrity-protected and cannot select another user's view. Recheck membership before every page. The feed returns only current authorized projections; authorization changes return `RESYNC_REQUIRED`, force removal of revoked cached data, and require a fresh snapshot. Expired (>30-day) cursor likewise requires resnapshot.
- `POST /fleets/:fleetId/imports/preview`, `POST .../imports/:id/commit`, `GET .../imports/:id`: owner-only sanitized migration and manifest operations defined in section 8.
- `POST /fleets/:fleetId/ai/extractions`: authorized ready attachment plus purpose and idempotency key; returns 202 job ID. `GET /fleets/:fleetId/jobs/:id` returns safe status/result preview. Applying extracted values is an ordinary explicit submission/manager action, never a worker side effect.
- `GET /fleets/:fleetId/notifications`, `PATCH .../notifications/:id/read`: user-visible in-app notices; push contains only a generic message plus opaque navigation ID and reauthorizes when opened.
- `POST /fleets/:fleetId/support-grants` and revoke route: owner + step-up, scoped read actions, reason and bounded expiry.
- `/platform/*`: separate verified platform session/MFA and action policies; no generic tenant bypass route.

### 6.6 Transaction and idempotency rules

Mutations use stable operation IDs scoped to fleet, actor and action. A database unique constraint and canonical request hash are the authority; a process-memory cache is insufficient. Commit idempotency record, business mutation, audit and change events together. Simultaneous identical calls wait for/replay the committed result; an aborted transaction may be retried safely.

Retain submission operation IDs/source-effect uniqueness for the lifetime of the retained record. Retain generic mutation replay records at least 90 days. Mobile automatically retries outbox entries for at most 30 days; older entries move to explicit review and must not be resent under new IDs invisibly. Authentication/authorization is checked even for a replay. A successful server write with a lost response is resolved by the same key, not a duplicate record.

## 7. Mobile persistence and offline synchronization

### 7.1 Local model and states

Use account-and-fleet-partitioned SQLite for minimal cached records, sync cursor, local drafts and durable outbox. Copy queued photos from temporary camera output into app-private persistent storage before marking a capture saved. Record local checksums and photo-upload progress. Do not rely on a temporary image URI surviving a restart.

Outbox states: `draft → queued → uploading_attachments → ready_to_submit → sending → accepted`; exceptions `auth_required`, `retry_wait`, `needs_review`, `access_revoked`, `discarded`. A submission's server approval state is separate: `pending_review|approved|rejected`. “Accepted” means received by the server, not approved maintenance/financial data.

Write draft payload, stable operation ID and attachment references in one SQLite transaction. Retain local source files until upload and server acceptance are confirmed, then remove them after seven days unless still needed for a failed operation. Display unsent count and an explicit retry action. Never delete an unacknowledged outbox entry just because its HTTP request was sent.

Use Expo SecureStore for durable credentials and a separate per-account cache key. For pilot builds containing sensitive offline data, enable/test SQLite SQLCipher in a native development/release build and verify `cipher_version`; do not assume setting a key encrypts a build without SQLCipher. SQLCipher support requires native build configuration and is not supplied by Expo Go. [Expo SQLite encryption guidance](https://docs.expo.dev/versions/latest/sdk/sqlite/). Photo files remain app-private with OS file protection/backup exclusion; database encryption does not encrypt those files. Do not claim full device or photo encryption from SQLCipher alone.

Do not store refresh tokens in SQLite, IndexedDB, AsyncStorage or logs. [React Native security](https://reactnative.dev/docs/security), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).

### 7.2 Sync algorithm

1. On login/resume or manual retry, refresh authentication online and fetch current memberships/assignments. Before replaying the outbox, process access changes.
2. Restore an authorized snapshot/feed cursor; remove revoked equipment projections rather than leaving them visible indefinitely.
3. For each queued operation, preserve its original ID and payload; upload/finalize/validate attachments first. Stop at a dependency failure; never submit a reference to a partial object.
4. Submit under the original idempotency key. Mark accepted only after a server response or successful replay lookup. Persist returned server ID/status before local cleanup.
5. Pull authorized deltas and advance the cursor in the same local transaction that applies them. Deduplicate repeated feed pages by entity ID/revision.
6. Retry transient network/429/503 failures with exponential backoff and jitter, capped at five minutes. Refresh credentials for 401; park 403/404 scope failures for human attention; park 409 changed-payload conflicts. Do not hammer a rejected operation.
7. Foreground requests have bounded timeouts and one sync loop per account/fleet. A process crash can restart the loop safely because all operations are durable/idempotent.

Server authorization uses current assignment, not device-asserted capture time. If an assignment ended while offline, reject the queued submission with `ASSIGNMENT_CHANGED`; retain it locally for an authorized manager-assisted resolution or explicit discard. The original driver cannot force acceptance by backdating the payload. An assisted import is a new audited manager action, not permission bypass or impersonation.

### 7.3 Offline access and logout

Allow minimal cached read/capture for up to 24 hours since the last successful online permission validation. Show expiry and last sync; expiry blocks viewing/capture until revalidation. This is a product control on a trusted device, not tamper-proof remote revocation. Device-clock rollback/rooted phones are outside that guarantee. Do not cache full insurance financial records or fleet-wide history on driver phones.

On logout/account switch: warn about pending work, offer sync while authenticated or explicit discard, remove account credentials/push registration, and wipe cache/files after confirmed logout. If offline, remote session/token revocation completes when reachable, but local credentials/data are removed immediately after the user confirms discard/logout. Partition keys prevent the next account reading the old cache. Losing/reinstalling a device can lose unuploaded data; there is no server backup of work that never reached it.

Background synchronization is opportunistic and must not be the sole delivery path. OS scheduling can delay or stop work; foreground resume/manual retry is required. [Expo background task constraints](https://docs.expo.dev/versions/latest/sdk/background-task/). Offline photo capture does not provide offline cloud OCR.

## 8. Legacy IndexedDB migration

### 8.1 Source and sanitization

Existing local stores include equipment, maintenance, records, fuel, permits, insurance and settings. Source IDs are local numeric values; they cannot become globally trusted IDs. Legacy backups may omit newer stores or contain fields/data shapes that differ across versions.

An owner exports the database from each relevant original browser/origin. Encrypted backup decryption happens locally in the existing trusted browser workflow. Before sending anything, build an allowlisted migration payload that omits all API keys, credentials, demo markers, local preferences and unknown secret-bearing fields. Server validates and rejects secret/settings fields again. Never upload the raw settings table by default.

Assign a durable source namespace to each distinct legacy database; reimports of the same source must reuse it. Do not merge independently created device databases merely because numeric IDs match. Preserve original export checksum, source namespace, import version and record provenance. Legacy author is `legacy_unknown`, not the importing owner's claimed historical authorship.

### 8.2 Preview and commit

`POST .../imports/preview` accepts `{schemaVersion, sourceNamespace, sourceChecksum, mode: "initial|merge", data}` with owner auth and idempotency. Limit sanitized JSON to 20 MiB and 50,000 total rows for pilot; larger imports require an offline migration runbook. Stream-limit bytes before JSON parsing.

Validate all references/types, enums, units/currencies, decimal amounts, date bounds, duplicate units and attachment availability. Preserve one fuel stop with multiple lines and do not double-count totals. Map `(fleet, sourceNamespace, entityType, legacyId)` to hosted UUIDs. Unit-number matches across sources require an explicit mapping decision. Similar service/fuel entries are review candidates, not automatic duplicates.

Preview returns counts by store, proposed adds/matches/conflicts/rejections, before/after spend totals, missing-attachment list, secret-field rejection summary, `previewFleetRevision`, and a hash binding payload plus decisions. A rejected secret field blocks commit until the payload is sanitized; do not echo its value. Preview data expires after 24 hours. Source attachments embedded in backups must be separately validated/imported into private storage; invalid/missing objects remain manifest warnings requiring acknowledgement.

`POST .../imports/:id/commit` takes `{expectedFleetRevision, approvedManifestHash}` and a stable idempotency key. Require matching unchanged preview, resolved conflicts and explicit acknowledgements. Lock fleet, revalidate owner and constraints, create/update agreed rows and ID mappings, audit and record changes in one short database transaction. Prepared attachments are staged beforehand; do not keep the transaction open for uploads/AI. If runtime limits cannot support the all-or-nothing pilot bounds, lower admission limits rather than quietly committing partial batches.

Initial import is allowed only into an empty fleet. Merge mode requires explicit decisions and must not decrease current readings or overwrite edited records without a documented correction. Committing the same source/checksum/manifest again returns the original result. Do not expose a hosted “replace all fleets/data” endpoint.

### 8.3 Cutover and rollback

Keep untouched source backups. Compare entity counts, relationships, open PM status, per-currency financial totals and attachment counts before marking import complete. Disable hosted writes from the old local mode; keep legacy data accessible as a clearly labeled archive/demo only.

Record created IDs and pre-change revisions for an import. A batch can be reversed automatically only when no subsequent user changes/reference activity depend on it. Otherwise use an audited corrective migration. For a controlled initial cutover with no intervening writes, restore the coordinated pre-import snapshot; do not restore the entire production database to reverse one customer's later import.

## 9. Background jobs, AI and notifications

### 9.1 Durable worker

Job fields: UUID, fleet ID, kind, payload reference, status `queued|running|succeeded|failed`, attempts/max attempts, `available_at`, claim token, worker ID, lease expiry/heartbeat, result reference, safe error code and lifecycle timestamps. Never store secrets/raw photos in job payloads. Enforce uniqueness for a business job key, such as attachment/purpose/version or reminder entity/threshold/day.

Claim in a short transaction using a CTE selecting one due row `FOR UPDATE SKIP LOCKED`, then updating it to running, incrementing attempts, assigning a fresh UUID claim token and a 60-second lease; commit before external work. Heartbeat every 10 seconds on a separate connection. Progress/completion/retry updates require running state, matching token and unexpired lease. Use fresh database time after acquiring a row lock when validating publication. A stale worker may execute work again but cannot publish an obsolete result. [PostgreSQL queue-consumer locking](https://www.postgresql.org/docs/current/sql-select.html).

Reap expired claims at least every 10 seconds, requeue with bounded backoff or fail after three attempts. Initial retry delays 5 and 30 seconds plus jitter. Set provider/scan request timeouts and a two-minute default attempt deadline; exports may declare a larger bounded deadline. Separate deadline from heartbeats so a live but hung job cannot run forever. Permanent invalid input is not retried. Publication of attachment state/AI result/in-app notice and job state is transactional. Delivery is at least once; effects must be idempotent.

Worker service credentials and queue metadata access are narrowly scoped. Revalidate source visibility and fleet lifecycle before external sends. Job cancellation on fleet offboarding prevents future work; if an in-flight external request has already left the system, cancellation cannot unsend it.

### 9.2 AI

Keep the existing provider behind a server adapter initially; changing providers is not required. Store a platform-managed key in the secret store; customer-supplied key management is deferred. No mobile/browser API key. Explicit user action starts extraction, with a visible external-processing notice. Check fleet allowance and attachment authorization first.

Return structured suggestions with provider/model version, warnings and traceable source attachment; validate schema, enums and numeric bounds. Prompts and model output are untrusted. Never allow a model to authorize a user, change roles, execute arbitrary tools or save canonical records. User reviews suggested readings/fuel/service fields before creating the normal submission/admin mutation. Retain current maintenance sanity/monotonicity guardrails and add server tests.

Initial quotas: 100 OCR/AI requests per fleet/day, one in-flight request per user, configurable hard platform spend ceiling. A quota/provider error offers manual entry; it never prevents ordinary maintenance tracking. Do not describe confidence as verified accuracy. Whether a model/provider stores input must be disclosed according to the selected service's terms before production use.

### 9.3 Reminders and push

Evaluate server reminders at least daily per fleet timezone using accepted records and freshness. Dedupe by fleet, entity, rule, threshold and business date; keep durable in-app notices. Before sending, verify active membership, assignment and registered device ownership. Driver payloads must not include sensitive policy numbers, receipt amounts or photo URLs on a lock screen.

Push is best effort and not an operational guarantee. Failed/invalid tokens are disabled; in-app state remains authoritative. Missing permission/token does not prevent use. Store distribution and production push credentials require real-device testing; do not treat Expo Go as release validation.

## 10. Storage, security and operations

### 10.1 Proposed pilot limits and retention

Defaults are product decisions to confirm before deployment:

- JSON body 1 MiB except bounded import route; image/document limits in section 6.
- Per user 60 ordinary mutations/minute, 10 upload intents/minute; per fleet daily AI quota; tune with measured workload and return actionable 429 responses.
- Queued mobile capture ≤200 operations / 250 MiB per account; warn near limits and stop new photo capture safely when full. Do not silently drop old work.
- Unfinalized/unreferenced staged objects: delete after 24 hours with an ownership/reference grace check.
- Rejected/quarantined uploads: purge within seven days unless needed for a documented incident.
- Saved fleet business records and linked attachments: retain while active by default; archive/retention settings must account for customer obligations. Final legal/regulatory retention is not established by this spec.
- Audit history: proposed minimum one year, with privileged events retained per finalized policy.
- Fleet closure: freeze writes, offer owner export, 30-day recovery window, then purge under the documented retention policy. Backup expiry and any required holds are disclosed; do not promise immediate secure erasure.

### 10.2 Security controls

TLS, private storage, managed secrets, minimal database roles, schema validation, parameterized queries, safe rendered text and a restrictive web content policy are baseline requirements. Native app bundles cannot keep provider secrets. Separate production identity/storage/databases from development. Redact tokens, signed upload URLs, personal details and receipt bodies from logs.

Protect bulk export, import, invitation, member changes, attachment download, sync feeds, worker jobs and support routes with the same tenant policies as ordinary CRUD. Do not rely on UUID secrecy. Add MFA/step-up, rate limits and auditability to privileged operations. Prevent mass assignment by explicit field allowlists; client PATCH cannot alter fleet, author, approval state or role outside designated workflows.

Mobile cache/file protection is defense against casual exposure, not a guarantee on compromised/unlocked devices. Recommend device passcodes for pilot users; cache only the data needed for driver workflows. Enforce backup exclusion for temporary/pending media where practical and test deletion on account change. No background GPS collection.

### 10.3 Deployment and recovery

Host web and API under one site with `/api` routing where feasible, simplifying cookie/CSRF behavior. Mobile calls the same API with bearer authentication. Restrict allowed web origins; do not combine wildcard CORS with credentialed sessions. Keep a stable API base and deep-link association files for mobile releases.

Use expand/migrate/contract database changes; deployed mobile clients may lag. Version payloads and support at least the current and previous released mobile schema through the pilot. Return `UPGRADE_REQUIRED` without deleting unsent drafts when an incompatible client reconnects; provide a migration/export support path for pending data.

Proposed recovery targets: database RPO ≤15 minutes with managed point-in-time recovery, object protection/versioning appropriate to matching records, and RTO ≤4 hours in the pilot. These are targets until a timed restore of database plus attachments has succeeded. Perform daily backup checks and a pre-pilot restore rehearsal. Coordinate object/database cut points; restoration must detect missing attachment references rather than silently displaying success.

Monitor API error/latency, denied authorization, outbox failures, oldest queued job, expired leases, provider costs, scan errors, missing objects and backup health. Logs correlate request/fleet/actor/operation/job IDs. Health endpoints reveal dependency status without credentials or tenant details. Alert on unusual platform access and repeated cross-tenant denial attempts.

## 11. Verification and acceptance

All thresholds below are proposed targets. The existing repository's claimed test count is not evidence of hosted/mobile correctness. Record the actual build/test results and device versions during implementation.

### 11.1 Functional and domain cases

- Owner creates a fleet, invites two drivers, assigns different units and reviews each driver's reading/fuel/issue submission from another device.
- Driver sees only assigned equipment and their own activity; admin sees the fleet; owner controls role promotion/transfer; platform support cannot read fleet data without a grant.
- A fleet with unit “101” coexists with another fleet's unit “101”; duplicate normalized unit numbers inside one fleet fail.
- Odometer/hour/calendar tests cover exact due boundaries, missing baselines, timezone date changes, rollover/replacement and stale readings.
- Fuel multi-product tests preserve allocation, decimal rounding and single-count totals. Service duplicate warnings allow legitimate multiple services.
- OCR suggestions require review; wrong values can be corrected; provider failure leaves manual entry available.
- Archive/correction retains record history and reason. Driver-facing projections omit restricted financial/document fields.

### 11.2 Authorization and concurrency cases

Use real PostgreSQL and independent connections/processes for RLS, locking and transaction tests:

- Test every action in the matrix for each role, wrong fleet, suspended member, expired support grant and ended assignment.
- Probe nested resource IDs, filters, cursor tampering, attachment parent links, imports, export, AI and jobs for cross-fleet access.
- Reuse pooled connections across fleets; missing tenant context denies and old context never leaks.
- Attempt role escalation/author override by JSON fields; verify no effect.
- Race two approvals of one submission; one decision and one business effect exist.
- Race edits of one revision; one succeeds, one returns 409 without losing the first update.
- Race owner transfer/member removal; exactly one active owner remains and no unauthorized promotion occurs.
- Lose an HTTP response after commit; retry with the same key returns the original effect. Change payload under the same key; receive conflict.
- Expire a worker lease and allow another worker to claim; stale worker cannot finalize attachments, AI or notices.

### 11.3 Mobile/offline cases

On physical iPhone and Android release/development builds:

- Capture reading/photo offline; kill/restart app; local work remains and uploads exactly once when the foreground sync reconnects.
- Interrupt object upload, finalization and submission acknowledgement separately; each resumes safely.
- Deny camera permission, disconnect network, expire auth, fill local quota and return stale cursors; each has a usable state and manual recovery.
- End an assignment or suspend a driver while offline; queued work is denied/parked on reconnect, and revoked cached equipment is removed.
- Logout/switch accounts with pending work; warn, require a decision and prevent cross-account cache/photo access.
- Let offline authorization expire; block further access until online revalidation and disclose offline revocation limitations.
- Receive a push after membership removal; opening it denies access and push delivery is subsequently revoked.
- Verify SQLite encryption is actually present in the native build, credentials are not in plain local storage, and temporary camera paths are not the only photo copy.

### 11.4 Migration/recovery cases

- Import representative legacy v1 exports with omitted newer stores, encrypted input locally decrypted, duplicate numeric IDs from distinct sources, multi-line fuel, permits/insurance and attachments.
- Server rejects unsanitized settings/secrets without echoing their values.
- Dry run catches orphan references, unit collisions, currency/unit ambiguity and stale preview revisions; commit does not partially apply invalid data.
- Repeated same manifest does not duplicate rows; reconciliation counts and per-currency spend match approved source values.
- Roll back an untouched initial import; refuse automatic destructive rollback after intervening edits.
- Restore database and object store on staging, validate record/attachment links and measure RPO/RTO.

### 11.5 Pilot release gate

All required workflows and denial tests pass; a real restore rehearsal passes; release builds work on both test platforms; no known cross-tenant or duplicate-effect defect remains. Proposed p95 ordinary read/write latency <500 ms at 25 concurrent users on a documented representative dataset, excluding upload/OCR. Measure sync completion under a controlled reconnect scenario and publish the workload/network conditions, rather than promising immediate background sync.

At least one owner and two drivers complete a supervised pilot across separate devices. Document unresolved usability issues, actual cloud costs and deferred modules. A failed security/data-integrity gate blocks wider rollout regardless of cosmetic readiness.

## 12. Caveats and implementation references

The 7–10-week estimate in PLAN.md is a planning range for one experienced developer and controlled pilot, not a delivery guarantee. App-store approval, identity-provider configuration, current code defects, file protection, migration variants and offline conflict handling can extend it. Backend authorization and data migration remain necessary regardless of mobile framework.

The repository review establishes an existing local implementation; this spec proposes the hosted behavior. Vendor names and exact versions remain to be selected and verified. No app, cloud environment or integration has been built by producing these files.

- [Repository baseline](https://github.com/ZynzTehr/fleet-pulse/tree/88e9f01537774915d068afb56d81cf05534e2536)
- [Fastify schema validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Expo camera](https://docs.expo.dev/versions/latest/sdk/camera/), [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Expo background-task limits](https://docs.expo.dev/versions/latest/sdk/background-task/)
- [React Native security](https://reactnative.dev/docs/security)
- [OAuth for native apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) and [tenant isolation](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) and [locking/queue consumers](https://www.postgresql.org/docs/current/sql-select.html)
