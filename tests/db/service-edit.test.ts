import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { archiveEquipment, getEquipment } from "@/server/equipmentStore";
import { applyDefaultSchedule, listSchedules } from "@/server/scheduleStore";
import { deleteServiceRecord, listFleetServiceRecords, listServiceRecords, logService, updateServiceRecord } from "@/server/serviceStore";
import { recordReading } from "@/server/readingsStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
const actor = () => ({ fleetId: a.fleetId, userId: "user-a" });
const oilItem = async () => (await listSchedules(db, a.fleetId, a.equipmentId))[0];
const log = async (input: Parameters<typeof logService>[2]) => {
  const r = await logService(db, actor(), input);
  if (!r.ok) throw new Error(`setup: ${r.code}`);
  return r.record;
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  b = await seedFleet(db, { userId: "user-b" });
});
beforeEach(async () => {
  a = await seedFleet(db, { userId: `user-a-${crypto.randomUUID()}` }); // tractor at 480,000, fresh per test
  await applyDefaultSchedule(db, a.fleetId, a.equipmentId);
});
afterAll(() => close());

describe("editing a service record", () => {
  it("replaces the fields, keeps the unit, and moves the schedule baseline with the new date and reading", async () => {
    const oil = await oilItem();
    const rec = await log({ equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-10-01", reading: 480500, cost: 100 });
    expect(rec.scheduleId).toBe(oil.id);

    const r = await updateServiceRecord(db, actor(), rec.id, { scheduleId: oil.id, date: "2026-10-05", serviceType: "Oil and filter", reading: 481200, cost: 120.5, shop: "Loves", notes: "Synthetic" });
    expect(r).toMatchObject({ ok: true, record: { id: rec.id, equipmentId: a.equipmentId, date: "2026-10-05", serviceType: "Oil and filter", mileage: 481200, cost: 120.5, shop: "Loves", notes: "Synthetic" } });
    expect(await oilItem()).toMatchObject({ lastServiceDate: "2026-10-05", lastServiceMileage: 481200 });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481200);
  });

  it("unlinking a record from its schedule item clears a baseline only that record set", async () => {
    const oil = await oilItem();
    const rec = await log({ equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-10-01", reading: 480500 });
    await updateServiceRecord(db, actor(), rec.id, { scheduleId: null, date: "2026-10-01", serviceType: "Oil change", reading: 480500 });
    expect(await oilItem()).toMatchObject({ lastServiceDate: null, lastServiceMileage: null });
  });

  it("checks for a same-day duplicate against other records, not itself", async () => {
    const first = await log({ equipmentId: a.equipmentId, date: "2026-10-02", serviceType: "Brake adjustment" });
    const second = await log({ equipmentId: a.equipmentId, date: "2026-10-03", serviceType: "Brake adjustment" });
    expect(await updateServiceRecord(db, actor(), first.id, { date: "2026-10-02", serviceType: "brake adjustment", cost: 50 })).toMatchObject({ ok: true });
    expect(await updateServiceRecord(db, actor(), second.id, { date: "2026-10-02", serviceType: "Brake adjustment" }))
      .toMatchObject({ ok: false, code: "possible-duplicate", existing: { id: first.id } });
    expect(await updateServiceRecord(db, actor(), second.id, { date: "2026-10-02", serviceType: "Brake adjustment", confirmDuplicate: true })).toMatchObject({ ok: true });
  });

  it("refuses another fleet's record and another unit's schedule item", async () => {
    const theirs = await logService(db, { fleetId: b.fleetId, userId: "user-b" }, { equipmentId: b.equipmentId, date: "2026-10-01", serviceType: "Oil" });
    if (!theirs.ok) throw new Error("setup");
    expect(await updateServiceRecord(db, actor(), theirs.record.id, { date: "2026-10-01", serviceType: "hijack" })).toMatchObject({ ok: false, code: "not-found" });
    await applyDefaultSchedule(db, b.fleetId, b.equipmentId);
    const [otherItem] = await listSchedules(db, b.fleetId, b.equipmentId);
    const mine = await log({ equipmentId: a.equipmentId, date: "2026-10-01", serviceType: "Oil" });
    expect(await updateServiceRecord(db, actor(), mine.id, { scheduleId: otherItem.id, date: "2026-10-01", serviceType: "Oil" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await deleteServiceRecord(db, a.fleetId, theirs.record.id)).toMatchObject({ ok: false, code: "not-found" });
    expect(await listServiceRecords(db, b.fleetId, b.equipmentId)).toHaveLength(1);
  });
});

describe("deleting a service record", () => {
  it("falls the schedule item back to its previous service, then clears it when none is left", async () => {
    const oil = await oilItem();
    const older = await log({ equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-08-01", reading: 470000 });
    const newer = await log({ equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-10-01", reading: 480900 });
    expect(await oilItem()).toMatchObject({ lastServiceDate: "2026-10-01", lastServiceMileage: 480900 });

    expect(await deleteServiceRecord(db, a.fleetId, newer.id)).toEqual({ ok: true });
    expect(await oilItem()).toMatchObject({ lastServiceDate: "2026-08-01", lastServiceMileage: 470000 });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(480900); // readings are history; they stay

    await deleteServiceRecord(db, a.fleetId, older.id);
    expect(await oilItem()).toMatchObject({ lastServiceDate: null, lastServiceMileage: null });
  });

  it("takes the unit's reading on that day when the remaining record has none", async () => {
    const oil = await oilItem();
    await recordReading(db, actor(), { equipmentId: a.equipmentId, value: 481000, source: "manual", observedAt: new Date("2026-09-10T15:00:00Z") });
    await log({ equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-09-15" });
    const newer = await log({ equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-10-01", reading: 482000 });
    await deleteServiceRecord(db, a.fleetId, newer.id);
    expect(await oilItem()).toMatchObject({ lastServiceDate: "2026-09-15", lastServiceMileage: 481000 });
  });
});

describe("fleet-wide service history", () => {
  it("lists every unit's records newest first, keeps removed units, and filters by unit and date range", async () => {
    const [second] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "202", normalizedUnitNumber: "202", type: "reefer" }).returning();
    await log({ equipmentId: a.equipmentId, date: "2026-09-01", serviceType: "Tires" });
    await log({ equipmentId: second.id, date: "2026-10-01", serviceType: "Reefer PM" });
    await archiveEquipment(db, a.fleetId, second.id);

    const all = await listFleetServiceRecords(db, a.fleetId);
    expect(all.map((r) => [r.unitNumber, r.serviceType, r.unitRemoved])).toEqual([["202", "Reefer PM", true], ["101", "Tires", false]]);
    expect((await listFleetServiceRecords(db, a.fleetId, { equipmentId: a.equipmentId })).map((r) => r.serviceType)).toEqual(["Tires"]);
    expect((await listFleetServiceRecords(db, a.fleetId, { from: "2026-09-15", to: "2026-12-31" })).map((r) => r.serviceType)).toEqual(["Reefer PM"]);
    expect(await listFleetServiceRecords(db, b.fleetId, { equipmentId: a.equipmentId })).toEqual([]);
  });
});

it("a deleted record's schedule link does not block deleting the schedule item", async () => {
  const oil = await oilItem();
  const rec = await log({ equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-10-01" });
  await db.delete(schema.maintenanceSchedules).where(eq(schema.maintenanceSchedules.id, oil.id));
  expect((await listServiceRecords(db, a.fleetId, a.equipmentId)).find((r) => r.id === rec.id)?.scheduleId).toBeNull();
});
