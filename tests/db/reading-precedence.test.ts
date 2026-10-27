import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addFuelStop } from "@/server/fuelStore";
import { getEquipment } from "@/server/equipmentStore";
import { recordReading } from "@/server/readingsStore";
import { logService } from "@/server/serviceStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

// Regression: in the live run, a service logged seconds after a confirmed lower reading carried the old
// value and moved the meter back up. Older evidence must never roll back the current reading.
let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
const actor = () => ({ fleetId: a.fleetId, userId: "user-a" });
const mileage = async () => (await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" }); // 480,000 mi
  await recordReading(db, actor(), { equipmentId: a.equipmentId, value: 482150, observedAt: new Date("2026-10-25T15:00:00Z") });
  await recordReading(db, actor(), { equipmentId: a.equipmentId, value: 470000, confirmLower: true, note: "Cluster replaced", observedAt: new Date("2026-10-26T18:00:00Z") });
});
afterAll(() => close());

describe("reading precedence", () => {
  it("a service dated before the latest reading does not move the meter, even with a higher value", async () => {
    await logService(db, actor(), { equipmentId: a.equipmentId, date: "2026-10-26", serviceType: "Oil", reading: 482150 });
    expect(await mileage()).toBe(470000);
  });

  it("a fuel stop dated before the latest reading does not move the meter either", async () => {
    await addFuelStop(db, actor(), { date: "2026-10-26", lines: [{ equipmentId: a.equipmentId, product: "diesel", subtotal: 100, odometer: 482200 }] });
    expect(await mileage()).toBe(470000);
  });

  it("a later service with a higher reading still moves it forward", async () => {
    await logService(db, actor(), { equipmentId: a.equipmentId, date: "2026-10-28", serviceType: "Tires", reading: 470900 });
    expect(await mileage()).toBe(470900);
  });

  it("keeps the service record's own mileage regardless", async () => {
    const { listServiceRecords } = await import("@/server/serviceStore");
    expect((await listServiceRecords(db, a.fleetId, a.equipmentId)).map((r) => r.mileage)).toContain(482150);
  });
});
