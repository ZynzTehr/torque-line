import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { applyDefaultSchedule, listSchedules } from "@/server/scheduleStore";
import { listServiceRecords, logService } from "@/server/serviceStore";
import { getEquipment } from "@/server/equipmentStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
const actor = () => ({ fleetId: a.fleetId, userId: "user-a" });
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" }); // tractor at 480,000
  b = await seedFleet(db, { userId: "user-b" });
  await applyDefaultSchedule(db, a.fleetId, a.equipmentId);
});
afterAll(() => close());

describe("logService", () => {
  it("records the service, resets that schedule's baseline, and raises the unit's reading", async () => {
    const [oil] = await listSchedules(db, a.fleetId, a.equipmentId);
    const result = await logService(db, actor(), { equipmentId: a.equipmentId, scheduleId: oil.id, date: "2026-10-20", reading: 481500, cost: 289.5, shop: "Rush Truck Center" });
    expect(result).toMatchObject({ ok: true });
    const updated = (await listSchedules(db, a.fleetId, a.equipmentId)).find((s) => s.id === oil.id);
    expect(updated).toMatchObject({ lastServiceDate: "2026-10-20", lastServiceMileage: 481500 });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481500);
    const [record] = await listServiceRecords(db, a.fleetId, a.equipmentId);
    expect(record).toMatchObject({ serviceType: oil.name, cost: 289.5, mileage: 481500, shop: "Rush Truck Center" });
  });

  it("asks before saving a same-day duplicate, then saves when confirmed", async () => {
    const [oil] = await listSchedules(db, a.fleetId, a.equipmentId);
    const input = { equipmentId: a.equipmentId, date: "2026-10-20", serviceType: oil.name.toUpperCase() };
    expect(await logService(db, actor(), input)).toMatchObject({ ok: false, code: "possible-duplicate", existing: { date: "2026-10-20" } });
    expect(await logService(db, actor(), { ...input, confirmDuplicate: true })).toMatchObject({ ok: true });
    expect(await listServiceRecords(db, a.fleetId, a.equipmentId)).toHaveLength(2);
  });

  it("keeps a lower service-record reading on the record without lowering the unit", async () => {
    await logService(db, actor(), { equipmentId: a.equipmentId, date: "2026-09-01", serviceType: "Tire rotation", reading: 470000 });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481500);
  });

  it("refuses another fleet's unit or schedule", async () => {
    expect(await logService(db, actor(), { equipmentId: b.equipmentId, date: "2026-10-20", serviceType: "Oil" })).toMatchObject({ ok: false, code: "not-found" });
    await applyDefaultSchedule(db, b.fleetId, b.equipmentId);
    const [theirs] = await listSchedules(db, b.fleetId, b.equipmentId);
    expect(await logService(db, actor(), { equipmentId: a.equipmentId, scheduleId: theirs.id, date: "2026-10-21" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await db.select().from(schema.serviceRecords)).toHaveLength(3);
  });

  it("validates dates and money", async () => {
    expect(await logService(db, actor(), { equipmentId: a.equipmentId, date: "2026-13-40", serviceType: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await logService(db, actor(), { equipmentId: a.equipmentId, date: "2026-10-01", serviceType: "x", cost: -5 })).toMatchObject({ ok: false, code: "invalid" });
  });
});
