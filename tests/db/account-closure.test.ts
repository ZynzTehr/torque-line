import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listFleetsForAdmin } from "@/server/adminStore";
import { DELETED_USER, purgeDueAccounts } from "@/server/accountPurge";
import { accountStateOf, closeAccount, reopenAccount, scheduleAccountDeletion } from "@/server/accountStore";
import { resolveFleetForUser } from "@/server/fleetStore";
import { memoryObjectStore } from "@/server/objectStore";
import { createTestDb, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;

const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows;
const DAY = 86_400_000;

// Neon Auth user ids are uuids. Each test gets its own people.
const person = (n: number, name: string) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, email: `${name.toLowerCase()}@example.com`, name,
});

// The slice of Neon Auth's own schema the purge touches, with the cascades a real branch has.
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.execute(sql`create schema neon_auth`);
  await db.execute(sql`create table neon_auth."user" (id uuid primary key, email text not null, name text)`);
  await db.execute(sql`create table neon_auth.session (id uuid primary key default gen_random_uuid(), token text not null,
    "userId" uuid not null references neon_auth."user"(id) on delete cascade, "expiresAt" timestamptz not null default now() + interval '7 days',
    "impersonatedBy" text)`);
  await db.execute(sql`create table neon_auth.account (id uuid primary key default gen_random_uuid(),
    "userId" uuid not null references neon_auth."user"(id) on delete cascade, password text)`);
  // One-time tokens and invitations name the user without a foreign key, so nothing cascades to them.
  await db.execute(sql`create table neon_auth.verification (id uuid primary key default gen_random_uuid(), identifier text not null,
    value text not null, "expiresAt" timestamptz not null default now() + interval '1 hour')`);
  await db.execute(sql`create table neon_auth.organization (id uuid primary key default gen_random_uuid(), name text not null)`);
  await db.execute(sql`create table neon_auth.invitation (id uuid primary key default gen_random_uuid(),
    "organizationId" uuid not null references neon_auth.organization(id) on delete cascade, email text not null,
    "inviterId" uuid not null references neon_auth."user"(id) on delete cascade)`);
});

/** The one-time token rows Better Auth leaves behind for a user until they are used. */
const pendingTokens = (who: { id: string; email: string }) => sql`insert into neon_auth.verification (identifier, value) values
  (${`reset-password:${crypto.randomUUID()}`}, ${who.id}),
  (${`email-verification-otp-${who.email}`}, 'hashed:0'),
  (${`change-email-otp-${who.email}-new@example.org`}, 'hashed:0'),
  (${who.email.toUpperCase()}, 'hashed:0')`;
const verificationRows = async () =>
  rowsOf<{ identifier: string; value: string }>(await db.execute(sql`select identifier, value from neon_auth.verification order by identifier`));
afterAll(() => close());

async function signUp(who: ReturnType<typeof person>) {
  await db.execute(sql`insert into neon_auth."user" (id, email, name) values (${who.id}::uuid, ${who.email}, ${who.name})`);
  await db.execute(sql`insert into neon_auth.session (token, "userId") values (${`token-${who.id}`}, ${who.id}::uuid)`);
  await db.execute(sql`insert into neon_auth.account ("userId", password) values (${who.id}::uuid, 'salt:hash')`);
  return resolveFleetForUser(db, who);
}

const makeDue = (userId: string) =>
  db.update(schema.accountStates).set({ purgeAfter: sql`now() - interval '1 minute'` }).where(eq(schema.accountStates.userId, userId));
const authUserCount = async (userId: string) =>
  rowsOf<{ n: number }>(await db.execute(sql`select
    (select count(*) from neon_auth."user" where id = ${userId}::uuid) + (select count(*) from neon_auth.session where "userId" = ${userId}::uuid)
    + (select count(*) from neon_auth.account where "userId" = ${userId}::uuid) as n`))[0].n;

/** Every row of every app table, as text, so a test can search the whole database for an identifier. */
async function everyRowAsText(): Promise<string> {
  const tables = rowsOf<{ name: string }>(await db.execute(sql`
    select table_name as name from information_schema.tables where table_schema in ('public', 'neon_auth') and table_type = 'BASE TABLE'`));
  const parts: string[] = [];
  for (const { name } of tables) {
    const qualified = sql.raw(rowsOf<{ q: string }>(await db.execute(sql`select format('%I.%I', table_schema, table_name) as q
      from information_schema.tables where table_name = ${name} and table_schema in ('public', 'neon_auth') limit 1`))[0].q);
    for (const r of rowsOf<{ t: string }>(await db.execute(sql`select t::text as t from ${qualified} t`))) parts.push(r.t);
  }
  return parts.join("\n");
}

const anonCounts = async () => ({
  service: (await db.select().from(schema.anonServiceEvents)).length,
  fuel: (await db.select().from(schema.anonFuelLines)).length,
  readings: (await db.select().from(schema.anonMeterReadings)).length,
  diagnostics: (await db.select().from(schema.anonDiagnosticOutcomes)).length,
});

describe("close and reopen", () => {
  it("closing keeps every record and marks the account closed; reopening restores it", async () => {
    const ann = person(1, "Ann");
    const fleet = await signUp(ann);
    expect(fleet.account).toBeNull();
    expect(await closeAccount(db, ann.id)).toEqual({ ok: true });
    expect(await accountStateOf(db, ann.id)).toEqual({ state: "closed", purgeAfter: null });
    expect((await resolveFleetForUser(db, ann)).account).toEqual({ state: "closed", purgeAfter: null });
    expect(await closeAccount(db, ann.id)).toEqual({ ok: true }); // closing twice is harmless

    const [row] = await listFleetsForAdmin(db).then((rows) => rows.filter((r) => r.fleetId === fleet.fleetId));
    expect(row.account).toEqual({ state: "closed", purgeAfter: null });

    expect(await reopenAccount(db, ann.id)).toEqual({ ok: true, reopened: true });
    expect(await accountStateOf(db, ann.id)).toBeNull();
    expect((await resolveFleetForUser(db, ann)).account).toBeNull();
    expect(await db.select().from(schema.fleets).where(eq(schema.fleets.id, fleet.fleetId))).toHaveLength(1);
  });

  it("reopening keeps an admin pause in force", async () => {
    const pia = person(2, "Pia");
    const fleet = await signUp(pia);
    await db.update(schema.fleets).set({ status: "inactive" }).where(eq(schema.fleets.id, fleet.fleetId));
    await closeAccount(db, pia.id);
    await reopenAccount(db, pia.id);
    expect(await resolveFleetForUser(db, pia)).toMatchObject({ status: "inactive", account: null });
  });
});

describe("delete and restore", () => {
  it("schedules the purge 30 days out, keeps the first date when asked again, and restoring cancels it", async () => {
    const bea = person(3, "Bea");
    const fleet = await signUp(bea);
    await closeAccount(db, bea.id); // a closed account can still be scheduled for deletion
    const before = Date.now();
    const scheduled = await scheduleAccountDeletion(db, bea.id);
    if (!scheduled.ok) throw new Error(scheduled.message);
    expect(scheduled.purgeAfter.getTime()).toBeGreaterThan(before + 30 * DAY - 60_000);
    expect(scheduled.purgeAfter.getTime()).toBeLessThan(before + 30 * DAY + 60_000);
    expect((await resolveFleetForUser(db, bea)).account).toEqual({ state: "deletion_scheduled", purgeAfter: scheduled.purgeAfter });

    const again = await scheduleAccountDeletion(db, bea.id);
    expect(again).toEqual({ ok: true, purgeAfter: scheduled.purgeAfter });
    expect(await closeAccount(db, bea.id)).toEqual({ ok: true });
    expect(await accountStateOf(db, bea.id)).toEqual({ state: "deletion_scheduled", purgeAfter: scheduled.purgeAfter });

    const [row] = (await listFleetsForAdmin(db)).filter((r) => r.fleetId === fleet.fleetId);
    expect(row.account).toEqual({ state: "deletion_scheduled", purgeAfter: scheduled.purgeAfter });

    expect(await reopenAccount(db, bea.id)).toEqual({ ok: true, reopened: true });
    expect(await accountStateOf(db, bea.id)).toBeNull();
    expect((await purgeDueAccounts(db, memoryObjectStore())).purged).toBe(0);
    expect(await db.select().from(schema.fleets).where(eq(schema.fleets.id, fleet.fleetId))).toHaveLength(1);
    expect(await authUserCount(bea.id)).toBe(3);
  });

  it("does not purge before the 30 days are up", async () => {
    const cal = person(4, "Cal");
    const fleet = await signUp(cal);
    await scheduleAccountDeletion(db, cal.id);
    await db.update(schema.accountStates).set({ purgeAfter: sql`now() + interval '1 minute'` }).where(eq(schema.accountStates.userId, cal.id));
    expect(await purgeDueAccounts(db, memoryObjectStore())).toEqual({ purged: 0, failed: 0, filesDeleted: 0, filesLeft: 0 });
    expect(await db.select().from(schema.fleets).where(eq(schema.fleets.id, fleet.fleetId))).toHaveLength(1);
    expect(await authUserCount(cal.id)).toBe(3);
    await reopenAccount(db, cal.id);
  });
});

describe("purge after 30 days", () => {
  const dee = person(5, "Deedee");
  const keep = person(6, "Keeper");
  const store = memoryObjectStore();
  let fleetId = "";
  let keepFleetId = "";
  const ids: string[] = [];

  beforeAll(async () => {
    ({ fleetId } = await signUp(dee));
    ({ fleetId: keepFleetId } = await signUp(keep));
    const [truck, trailer] = await db.insert(schema.equipment).values([
      { fleetId, unitNumber: "ZX-417", normalizedUnitNumber: "ZX-417", type: "tractor", year: "2019", make: "Freightliner",
        model: "Cascadia", engineSize: "DD15", vin: "1FUJGLDR7CLBP8834", notes: "Bought from Jane Roe" },
      { fleetId, unitNumber: "TR-9", normalizedUnitNumber: "TR-9", type: "trailer", year: "old" },
    ]).returning();
    await db.insert(schema.readings).values([
      { fleetId, equipmentId: truck.id, kind: "odometer", value: 100_000, observedAt: new Date("2026-03-02T15:00:00Z"), createdBy: dee.id },
      { fleetId, equipmentId: truck.id, kind: "odometer", value: 101_500, observedAt: new Date("2026-03-29T15:00:00Z"), createdBy: dee.id, note: "Jane drove" },
      { fleetId, equipmentId: truck.id, kind: "odometer", value: 104_000, observedAt: new Date("2026-04-11T15:00:00Z"), createdBy: dee.id },
    ]);
    const [schedule] = await db.insert(schema.maintenanceSchedules).values({ fleetId, equipmentId: truck.id, name: "Oil & Filter Change", category: "PM-A", mileageInterval: 15000 }).returning();
    const [oil, custom] = await db.insert(schema.serviceRecords).values([
      { fleetId, equipmentId: truck.id, date: "2026-03-14", serviceType: "Oil & Filter Change", scheduleId: schedule.id, mileage: 101_000, cost: 350,
        shop: "Bob's Diesel", notes: "Called Jane Roe", createdBy: dee.id },
      { fleetId, equipmentId: trailer.id, date: "2026-04-02", serviceType: "Fixed per Jane Roe", cost: 80, createdBy: dee.id },
    ]).returning();
    const [stop] = await db.insert(schema.fuelStops).values({ fleetId, date: "2026-03-20", station: "Love's #123", notes: "Card ending 4242", total: 400, createdBy: dee.id }).returning();
    await db.insert(schema.fuelLines).values({ fleetId, stopId: stop.id, equipmentId: truck.id, product: "diesel", gallons: 100, pricePerGallon: 4, subtotal: 400, odometer: 101_200 });
    const [session] = await db.insert(schema.diagnosticSessions).values({
      fleetId, equipmentId: truck.id, symptom: "Jane Roe says it smokes", status: "resolved", resolutionNote: "Replaced filter", createdBy: dee.id,
    }).returning();
    await db.insert(schema.diagnosticTurns).values({ fleetId, sessionId: session.id, seq: 0, role: "user", content: { text: "Jane Roe says it smokes" } });
    await db.insert(schema.diagnosticCauses).values([
      { fleetId, sessionId: session.id, rank: 1, name: "Clogged air filter", likelihood: "high", why: "Jane's notes", howToCheck: "Look", costTier: "low", tried: true },
      { fleetId, sessionId: session.id, rank: 2, name: "Injector fault", likelihood: "medium", why: "w", howToCheck: "h", costTier: "high", ruledOut: true },
    ]);
    await db.insert(schema.aiUsage).values({ fleetId, day: "2026-03-14", requests: 3 });
    const receipts = [
      { kind: "service_receipt" as const, parentId: oil.id }, { kind: "service_receipt" as const, parentId: custom.id },
      { kind: "fuel_receipt" as const, parentId: stop.id }, { kind: "diagnostic_photo" as const, parentId: session.id },
    ];
    for (const r of receipts) {
      const storageKey = `fleets/${fleetId}/${r.kind}/${r.parentId}/${crypto.randomUUID()}.jpg`;
      await store.put(storageKey, new Uint8Array([1]), "image/jpeg");
      await db.insert(schema.attachments).values({ fleetId, ...r, storageKey, contentType: "image/jpeg", byteSize: 1, createdBy: dee.id });
    }
    await store.put(`fleets/${fleetId}/service_receipt/orphan.jpg`, new Uint8Array([1]), "image/jpeg"); // a file whose row is long gone
    await store.put(`fleets/${keepFleetId}/service_receipt/x/keep.jpg`, new Uint8Array([1]), "image/jpeg");
    // An admin who once paused someone else's fleet leaves their id behind there.
    await db.insert(schema.platformAdmins).values([{ userId: dee.id }, { userId: keep.id }]);
    await db.update(schema.fleets).set({ statusChangedBy: dee.id }).where(eq(schema.fleets.id, keepFleetId));
    // Leftovers in Neon Auth: an unused reset link and email codes, an invitation to her address, and a session she
    // opened as an impersonating admin. Keeper's own pending code must survive.
    await db.execute(pendingTokens(dee));
    await db.execute(sql`insert into neon_auth.verification (identifier, value) values (${`email-verification-otp-${keep.email}`}, 'hashed:0')`);
    const [org] = rowsOf<{ id: string }>(await db.execute(sql`insert into neon_auth.organization (name) values ('Shop') returning id`));
    await db.execute(sql`insert into neon_auth.invitation ("organizationId", email, "inviterId") values (${org.id}::uuid, ${dee.email}, ${keep.id}::uuid)`);
    await db.execute(sql`insert into neon_auth.session (token, "userId", "impersonatedBy") values ('as-keeper', ${keep.id}::uuid, ${dee.id})`);
    ids.push(dee.id, dee.email, fleetId, truck.id, trailer.id, oil.id, custom.id, stop.id, session.id, schedule.id);

    expect(await scheduleAccountDeletion(db, dee.id)).toMatchObject({ ok: true });
    await makeDue(dee.id);
  });

  it("deletes the fleet, every fleet-scoped row, the membership, the admin row and the auth user", async () => {
    const summary = await purgeDueAccounts(db, store);
    expect(summary).toEqual({ purged: 1, failed: 0, filesDeleted: 5, filesLeft: 0 });

    for (const table of [schema.equipment, schema.readings, schema.maintenanceSchedules, schema.serviceRecords, schema.fuelStops, schema.fuelLines,
      schema.diagnosticSessions, schema.diagnosticTurns, schema.diagnosticCauses, schema.aiUsage, schema.attachments, schema.memberships]) {
      expect(await db.select().from(table).where(eq(table.fleetId, fleetId))).toEqual([]);
    }
    expect(await db.select().from(schema.fleets).where(eq(schema.fleets.id, fleetId))).toEqual([]);
    expect(await db.select().from(schema.memberships).where(eq(schema.memberships.userId, dee.id))).toEqual([]);
    expect(await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.userId, dee.id))).toEqual([]);
    expect(await accountStateOf(db, dee.id)).toBeNull();
    expect(await authUserCount(dee.id)).toBe(0);
    expect(store.keys().filter((k) => k.startsWith(`fleets/${fleetId}/`))).toEqual([]);
    expect(store.keys()).toEqual([`fleets/${keepFleetId}/service_receipt/x/keep.jpg`]);
    expect(await authUserCount(keep.id)).toBe(3);
    expect(await verificationRows()).toEqual([{ identifier: `email-verification-otp-${keep.email}`, value: "hashed:0" }]);
    expect(rowsOf(await db.execute(sql`select 1 from neon_auth.invitation`))).toEqual([]);
    expect(rowsOf(await db.execute(sql`select 1 from neon_auth.session where token = 'as-keeper'`))).toEqual([]);
  });

  it("leaves nothing identifiable anywhere in the database", async () => {
    const everything = await everyRowAsText();
    expect(everything).toContain(keep.email); // the scan does see real rows
    for (const needle of [...ids, dee.email.toUpperCase(), "ZX-417", "TR-9", "1FUJGLDR7CLBP8834", "Jane", "Bob's", "Love's", "4242", "2026-03-14", "2026-03-20", "smokes", "Replaced filter"]) {
      expect(everything, needle).not.toContain(needle);
    }
  });

  it("keeps de-identified statistics, grouped by a random reference per former unit", async () => {
    const service = await db.select().from(schema.anonServiceEvents);
    const fuel = await db.select().from(schema.anonFuelLines);
    const readings = await db.select().from(schema.anonMeterReadings);
    const outcomes = await db.select().from(schema.anonDiagnosticOutcomes);
    const truckRef = fuel[0]?.unitRef;
    const oil = service.find((r) => r.serviceType !== "other")!;
    expect(oil).toMatchObject({ equipmentType: "tractor", year: 2019, make: "Freightliner", model: "Cascadia", engineSize: "DD15",
      serviceType: "oil and filter change", mileage: 101_000, hours: null, cost: 350, month: "2026-03-01" });
    const custom = service.find((r) => r.serviceType === "other")!;
    expect(custom).toMatchObject({ equipmentType: "trailer", year: null, make: null, cost: 80, month: "2026-04-01" });
    expect(custom.unitRef).not.toBe(truckRef);
    expect(oil.unitRef).toBe(truckRef);

    expect(fuel).toHaveLength(1);
    expect(fuel).toMatchObject([
      { equipmentType: "tractor", year: 2019, make: "Freightliner", model: "Cascadia", product: "diesel", gallons: 100, pricePerGallon: 4, month: "2026-03-01" },
    ]);
    expect(readings.map(({ unitRef, kind, month, value }) => ({ same: unitRef === truckRef, kind, month, value })).sort((x, y) => x.month.localeCompare(y.month)))
      .toEqual([{ same: true, kind: "odometer", month: "2026-03-01", value: 101_500 }, { same: true, kind: "odometer", month: "2026-04-01", value: 104_000 }]);
    expect(outcomes.map(({ causeName, likelihood, tried, ruledOut, resolved, unitRef }) => ({ causeName, likelihood, tried, ruledOut, resolved, same: unitRef === truckRef }))
      .sort((x, y) => x.causeName.localeCompare(y.causeName))).toEqual([
      { causeName: "Clogged air filter", likelihood: "high", tried: true, ruledOut: false, resolved: true, same: true },
      { causeName: "Injector fault", likelihood: "medium", tried: false, ruledOut: true, resolved: true, same: true },
    ]);
    expect(new Set(outcomes.map((o) => o.sessionRef)).size).toBe(1);
    // The references are fresh: none of them is an id the fleet ever had.
    for (const ref of [truckRef, custom.unitRef, outcomes[0].sessionRef]) expect(ids).not.toContain(ref);
  });

  it("is safe to run again: nothing more happens", async () => {
    const before = await anonCounts();
    expect(await purgeDueAccounts(db, store)).toEqual({ purged: 0, failed: 0, filesDeleted: 0, filesLeft: 0 });
    expect(await anonCounts()).toEqual(before);
  });

  it("clears the purged admin's id from fleets they once paused", async () => {
    const [kept] = await db.select().from(schema.fleets).where(eq(schema.fleets.id, keepFleetId));
    expect(kept.statusChangedBy).toBeNull();
  });
});

describe("the only platform admin", () => {
  it("can't close or delete their account until another admin with an open account exists", async () => {
    const solo = person(10, "Solo");
    const other = person(11, "Other");
    await signUp(solo);
    await signUp(other);
    await db.delete(schema.platformAdmins);
    await db.insert(schema.platformAdmins).values({ userId: solo.id });
    const refusal = { ok: false, code: "invalid", message: "You're the only platform admin. Add another admin before closing or deleting this account." };
    expect(await closeAccount(db, solo.id)).toEqual(refusal);
    expect(await scheduleAccountDeletion(db, solo.id)).toEqual(refusal);
    expect(await accountStateOf(db, solo.id)).toBeNull();

    // A second admin whose own account is closed doesn't count.
    await db.insert(schema.platformAdmins).values({ userId: other.id });
    await closeAccount(db, other.id);
    expect(await closeAccount(db, solo.id)).toEqual(refusal);
    await reopenAccount(db, other.id);
    expect(await closeAccount(db, solo.id)).toEqual({ ok: true });
    await reopenAccount(db, solo.id);
    await db.delete(schema.platformAdmins);
  });

  it("lets only one of the last two admins close when both try at once", async () => {
    const one = person(12, "One");
    const two = person(13, "Two");
    await signUp(one);
    await signUp(two);
    await db.insert(schema.platformAdmins).values([{ userId: one.id }, { userId: two.id }]);
    const results = await Promise.all([closeAccount(db, one.id), scheduleAccountDeletion(db, two.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([expect.objectContaining({ ok: false, code: "invalid" })]);
    expect(await db.select().from(schema.accountStates).where(sql`${schema.accountStates.userId} in (${one.id}, ${two.id})`)).toHaveLength(1);
    await reopenAccount(db, one.id);
    await reopenAccount(db, two.id);
    await db.delete(schema.platformAdmins);
  });
});

describe("a fleet with another owner", () => {
  it("stays with the other owner; only the leaving owner's membership and traces go", async () => {
    const lee = person(20, "Lee");
    const max = person(21, "Max");
    const { fleetId, equipmentId } = await signUp(lee).then(async (f) => {
      const [unit] = await db.insert(schema.equipment).values({ fleetId: f.fleetId, unitNumber: "S-1", normalizedUnitNumber: "S-1", type: "tractor" }).returning();
      return { fleetId: f.fleetId, equipmentId: unit.id };
    });
    await db.execute(neonUser(max));
    await db.insert(schema.memberships).values({ fleetId, userId: max.id, role: "owner" });
    await db.insert(schema.serviceRecords).values({ fleetId, equipmentId, date: "2026-05-01", serviceType: "Valve Adjustment", createdBy: lee.id });
    const before = await anonCounts();

    await scheduleAccountDeletion(db, lee.id);
    await makeDue(lee.id);
    expect(await purgeDueAccounts(db, memoryObjectStore())).toMatchObject({ purged: 1, failed: 0 });

    const [fleet] = await db.select().from(schema.fleets).where(eq(schema.fleets.id, fleetId));
    expect(fleet).toMatchObject({ ownerUserId: max.id, ownerEmail: null });
    expect((await db.select().from(schema.memberships).where(eq(schema.memberships.fleetId, fleetId))).map((m) => m.userId)).toEqual([max.id]);
    const [record] = await db.select().from(schema.serviceRecords).where(eq(schema.serviceRecords.fleetId, fleetId));
    expect(record).toMatchObject({ serviceType: "Valve Adjustment", createdBy: DELETED_USER });
    expect(await authUserCount(lee.id)).toBe(0);
    expect(await anonCounts()).toEqual(before);
    expect(await everyRowAsText()).not.toContain(lee.id);
    expect((await resolveFleetForUser(db, max)).fleetId).toBe(fleetId);
  });
});

describe("a fleet whose other owner already owns a fleet", () => {
  it("purges anyway, leaving the shared fleet under a placeholder owner", async () => {
    const lee = person(30, "Leigh");
    const max = person(31, "Maxine");
    const { fleetId } = await signUp(lee);
    const { fleetId: maxFleetId } = await signUp(max); // Maxine signed up first and got her own fleet
    await db.insert(schema.memberships).values({ fleetId, userId: max.id, role: "owner" });
    await db.execute(pendingTokens(lee));

    await scheduleAccountDeletion(db, lee.id);
    await makeDue(lee.id);
    expect(await purgeDueAccounts(db, memoryObjectStore())).toMatchObject({ purged: 1, failed: 0 });

    const [fleet] = await db.select().from(schema.fleets).where(eq(schema.fleets.id, fleetId));
    expect(fleet).toMatchObject({ ownerUserId: `${DELETED_USER}:${fleetId}`, ownerEmail: null });
    expect((await db.select().from(schema.memberships).where(eq(schema.memberships.fleetId, fleetId))).map((m) => m.userId)).toEqual([max.id]);
    const [own] = await db.select().from(schema.fleets).where(eq(schema.fleets.id, maxFleetId));
    expect(own.ownerUserId).toBe(max.id);
    expect(await authUserCount(lee.id)).toBe(0);
    const everything = await everyRowAsText();
    for (const needle of [lee.id, lee.email]) expect(everything, needle).not.toContain(needle);
  });
});

/** Max joins through an invitation, so he has an auth user but never got a fleet of his own. */
function neonUser(who: ReturnType<typeof person>) {
  return sql`insert into neon_auth."user" (id, email, name) values (${who.id}::uuid, ${who.email}, ${who.name})`;
}
