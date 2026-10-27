import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { DEFAULT_TEMPLATES } from "@/domain/templates";
import { addSchedule, applyDefaultSchedule, deleteSchedule, listSchedules, updateSchedule } from "@/server/scheduleStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
let trailerId: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" });
  b = await seedFleet(db, { userId: "user-b" });
  const [t] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "T-9", normalizedUnitNumber: "T-9", type: "trailer" }).returning();
  trailerId = t.id;
});
afterAll(() => close());

describe("schedule store", () => {
  it("applies the default schedule for the unit type once", async () => {
    expect(await applyDefaultSchedule(db, a.fleetId, a.equipmentId)).toEqual({ ok: true, added: DEFAULT_TEMPLATES.tractor.length });
    expect(await applyDefaultSchedule(db, a.fleetId, a.equipmentId)).toEqual({ ok: true, added: 0 });
    expect(await listSchedules(db, a.fleetId, a.equipmentId)).toHaveLength(DEFAULT_TEMPLATES.tractor.length);
  });

  it("adds a custom item and requires at least one trigger", async () => {
    expect(await addSchedule(db, a.fleetId, a.equipmentId, { name: "DPF clean", category: "PM-C", mileageInterval: 250000 })).toMatchObject({ ok: true });
    expect(await addSchedule(db, a.fleetId, a.equipmentId, { name: "Nothing", category: "PM-A" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses mileage triggers on equipment without an odometer", async () => {
    expect(await addSchedule(db, a.fleetId, trailerId, { name: "Brake check", category: "PM-A", mileageInterval: 10000 }))
      .toMatchObject({ ok: false, code: "invalid" });
    expect(await addSchedule(db, a.fleetId, trailerId, { name: "Brake check", category: "PM-A", timeInterval: 90 })).toMatchObject({ ok: true });
  });

  it("cannot read, add to, edit or delete another fleet's schedule", async () => {
    expect(await listSchedules(db, a.fleetId, b.equipmentId)).toEqual([]);
    expect(await addSchedule(db, a.fleetId, b.equipmentId, { name: "x", category: "PM-A", timeInterval: 30 })).toMatchObject({ ok: false, code: "not-found" });
    await applyDefaultSchedule(db, b.fleetId, b.equipmentId);
    const [theirs] = await listSchedules(db, b.fleetId, b.equipmentId);
    expect(await updateSchedule(db, a.fleetId, theirs.id, { enabled: false })).toMatchObject({ ok: false, code: "not-found" });
    expect(await deleteSchedule(db, a.fleetId, theirs.id)).toMatchObject({ ok: false, code: "not-found" });
    expect((await listSchedules(db, b.fleetId, b.equipmentId))[0].enabled).toBe(true);
  });

  it("pauses and edits intervals", async () => {
    const [item] = await listSchedules(db, a.fleetId, a.equipmentId);
    expect(await updateSchedule(db, a.fleetId, item.id, { enabled: false, mileageInterval: 20000 })).toMatchObject({ ok: true });
    const after = (await listSchedules(db, a.fleetId, a.equipmentId)).find((s) => s.id === item.id);
    expect(after).toMatchObject({ enabled: false, mileageInterval: 20000 });
  });
});
