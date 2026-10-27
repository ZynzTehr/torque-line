import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { addFuelStop, deleteFuelStop, listFuelStops, unitCostSummary } from "@/server/fuelStore";
import { logService } from "@/server/serviceStore";
import { getEquipment } from "@/server/equipmentStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
let reeferId: string;
const actor = () => ({ fleetId: a.fleetId, userId: "user-a" });
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" }); // tractor at 480,000
  b = await seedFleet(db, { userId: "user-b" });
  const [r] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "R-1", normalizedUnitNumber: "R-1", type: "reefer", currentHours: 8400 }).returning();
  reeferId = r.id;
});
afterAll(() => close());

describe("fuel store", () => {
  it("records one stop with several products and counts the total once", async () => {
    const r = await addFuelStop(db, actor(), { date: "2026-10-20", station: "Pilot #412", lines: [
      { equipmentId: a.equipmentId, product: "diesel", gallons: 120.5, pricePerGallon: 3.899, subtotal: 469.83, odometer: 481000 },
      { equipmentId: a.equipmentId, product: "def", gallons: 5, subtotal: 17.5 },
      { equipmentId: reeferId, product: "reefer", gallons: 30, subtotal: 110.97, hours: 8450 },
    ] });
    expect(r).toMatchObject({ ok: true });
    const [stop] = await listFuelStops(db, a.fleetId);
    expect(stop.total).toBe(598.3);
    expect(stop.lines).toHaveLength(3);
  });

  it("moves meters forward from fuel readings but never backward", async () => {
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481000);
    expect((await getEquipment(db, a.fleetId, reeferId))?.currentHours).toBe(8450);
    await addFuelStop(db, actor(), { date: "2026-09-01", lines: [{ equipmentId: a.equipmentId, product: "diesel", subtotal: 100, odometer: 470000 }] });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481000);
  });

  it("rejects mismatched products, duplicate products, and mixed trucks", async () => {
    expect(await addFuelStop(db, actor(), { date: "2026-10-21", lines: [{ equipmentId: reeferId, product: "diesel", subtotal: 10 }] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await addFuelStop(db, actor(), { date: "2026-10-21", lines: [
      { equipmentId: a.equipmentId, product: "diesel", subtotal: 10 }, { equipmentId: a.equipmentId, product: "diesel", subtotal: 5 },
    ] })).toMatchObject({ ok: false, code: "invalid" });
    const [t2] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "102", normalizedUnitNumber: "102", type: "tractor" }).returning();
    expect(await addFuelStop(db, actor(), { date: "2026-10-21", lines: [
      { equipmentId: a.equipmentId, product: "diesel", subtotal: 10 }, { equipmentId: t2.id, product: "def", subtotal: 5 },
    ] })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses another fleet's equipment and hides other fleets' stops", async () => {
    expect(await addFuelStop(db, actor(), { date: "2026-10-21", lines: [{ equipmentId: b.equipmentId, product: "diesel", subtotal: 10 }] }))
      .toMatchObject({ ok: false, code: "not-found" });
    await addFuelStop(db, { fleetId: b.fleetId, userId: "user-b" }, { date: "2026-10-21", lines: [{ equipmentId: b.equipmentId, product: "diesel", subtotal: 99 }] });
    const theirs = (await listFuelStops(db, b.fleetId))[0];
    expect((await listFuelStops(db, a.fleetId)).map((s) => s.id)).not.toContain(theirs.id);
    expect(await deleteFuelStop(db, a.fleetId, theirs.id)).toMatchObject({ ok: false, code: "not-found" });
  });

  it("summarizes a unit's service and fuel spend and cost per mile over tracked miles", async () => {
    await logService(db, actor(), { equipmentId: a.equipmentId, date: "2026-09-01", serviceType: "Oil", cost: 200, reading: 480500 });
    const s = await unitCostSummary(db, a.fleetId, a.equipmentId);
    expect(s).toMatchObject({ serviceSpend: 200, fuelSpend: 587.33 });
    expect(s!.rate).toBeCloseTo(787.33 / 11000, 4);
  });
});
