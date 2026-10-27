import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { recordReading } from "@/server/readingsStore";
import { getEquipment } from "@/server/equipmentStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" }); // tractor at 480,000 mi
  b = await seedFleet(db, { userId: "user-b" });
});
afterAll(() => close());

const history = (equipmentId: string) =>
  db.select().from(schema.readings).where(eq(schema.readings.equipmentId, equipmentId));

describe("recordReading", () => {
  it("appends a higher reading to history and updates the unit's current value", async () => {
    const result = await recordReading(db, { fleetId: a.fleetId, userId: "user-a" }, { equipmentId: a.equipmentId, value: 481200 });
    expect(result).toMatchObject({ ok: true, current: 481200 });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481200);
    expect(await history(a.equipmentId)).toHaveLength(1);
  });

  it("does not save a lower reading without explicit confirmation", async () => {
    const result = await recordReading(db, { fleetId: a.fleetId, userId: "user-a" }, { equipmentId: a.equipmentId, value: 470000 });
    expect(result).toEqual({ ok: false, code: "needs-confirmation", current: 481200, next: 470000 });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481200);
    expect(await history(a.equipmentId)).toHaveLength(1);
  });

  it("requires a reason when a lower reading is confirmed, then records it", async () => {
    const ctx = { fleetId: a.fleetId, userId: "user-a" };
    expect(await recordReading(db, ctx, { equipmentId: a.equipmentId, value: 470000, confirmLower: true })).toMatchObject({ ok: false, code: "invalid" });
    const saved = await recordReading(db, ctx, { equipmentId: a.equipmentId, value: 1200, confirmLower: true, note: "Odometer replaced" });
    expect(saved).toMatchObject({ ok: true, current: 1200 });
    const rows = await history(a.equipmentId);
    expect(rows.find((r) => r.value === 1200)).toMatchObject({ confirmedLower: true, note: "Odometer replaced" });
  });

  it("refuses another fleet's equipment without revealing it exists", async () => {
    const result = await recordReading(db, { fleetId: a.fleetId, userId: "user-a" }, { equipmentId: b.equipmentId, value: 999999 });
    expect(result).toMatchObject({ ok: false, code: "not-found" });
    expect(await history(b.equipmentId)).toHaveLength(0);
  });

  it("rejects trailers, which are tracked by date", async () => {
    const [trailer] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "T-1", normalizedUnitNumber: "T-1", type: "trailer" }).returning();
    expect(await recordReading(db, { fleetId: a.fleetId, userId: "user-a" }, { equipmentId: trailer.id, value: 10 })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("writes reefer readings to hours", async () => {
    const [reefer] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "R-1", normalizedUnitNumber: "R-1", type: "reefer", currentHours: 8400 }).returning();
    expect(await recordReading(db, { fleetId: a.fleetId, userId: "user-a" }, { equipmentId: reefer.id, value: 8420 })).toMatchObject({ ok: true, current: 8420 });
    expect(await getEquipment(db, a.fleetId, reefer.id)).toMatchObject({ currentHours: 8420, currentMileage: null });
  });
});
