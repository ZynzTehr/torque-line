import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { addFuelStop, fuelSpendByProduct, fuelYears, listFuelStops, updateFuelStop } from "@/server/fuelStore";
import { getEquipment } from "@/server/equipmentStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
let reeferId: string;
let truck2: string;
const actor = () => ({ fleetId: a.fleetId, userId: "user-a" });
const add = async (input: Parameters<typeof addFuelStop>[2]) => {
  const r = await addFuelStop(db, actor(), input);
  if (!r.ok) throw new Error(`setup: ${r.message}`);
  return r.id;
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" }); // tractor 101 at 480,000
  b = await seedFleet(db, { userId: "user-b" });
  const [r] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "R-1", normalizedUnitNumber: "R-1", type: "reefer", currentHours: 8400 }).returning();
  const [t] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "102", normalizedUnitNumber: "102", type: "tractor" }).returning();
  reeferId = r.id; truck2 = t.id;
});
afterAll(() => close());

describe("editing a fuel stop", () => {
  it("replaces date, station, notes, and lines, recomputes the total, and moves the meter only forward", async () => {
    const id = await add({ date: "2026-10-01", station: "Pilot", lines: [
      { equipmentId: a.equipmentId, product: "diesel", gallons: 100, pricePerGallon: 4, subtotal: 400, odometer: 481000 },
      { equipmentId: a.equipmentId, product: "def", subtotal: 20 },
    ] });
    expect(await updateFuelStop(db, actor(), id, { date: "2026-10-02", station: "Love's #512", notes: "Wrong pump at first", lines: [
      { equipmentId: a.equipmentId, product: "diesel", gallons: 110, pricePerGallon: 4, subtotal: 440, odometer: 481500 },
    ] })).toEqual({ ok: true, id });
    const [stop] = (await listFuelStops(db, a.fleetId)).filter((s) => s.id === id);
    expect(stop).toMatchObject({ date: "2026-10-02", station: "Love's #512", notes: "Wrong pump at first", total: 440 });
    expect(stop.lines).toEqual([expect.objectContaining({ product: "diesel", gallons: 110, pricePerGallon: 4, subtotal: 440, odometer: 481500, unitNumber: "101" })]);
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481500);

    await updateFuelStop(db, actor(), id, { date: "2026-10-02", lines: [{ equipmentId: a.equipmentId, product: "diesel", subtotal: 440, odometer: 481200 }] });
    expect((await getEquipment(db, a.fleetId, a.equipmentId))?.currentMileage).toBe(481500);
  });

  it("applies the same product rules as adding, and refuses another fleet's stop or unit", async () => {
    const id = await add({ date: "2026-10-03", lines: [{ equipmentId: a.equipmentId, product: "diesel", subtotal: 100 }] });
    expect(await updateFuelStop(db, actor(), id, { date: "2026-10-03", lines: [{ equipmentId: a.equipmentId, product: "reefer", subtotal: 10 }] }))
      .toMatchObject({ ok: false, code: "invalid" });
    expect(await updateFuelStop(db, actor(), id, { date: "2026-10-03", lines: [{ equipmentId: b.equipmentId, product: "diesel", subtotal: 10 }] }))
      .toMatchObject({ ok: false, code: "not-found" });
    const theirs = await addFuelStop(db, { fleetId: b.fleetId, userId: "user-b" }, { date: "2026-10-03", lines: [{ equipmentId: b.equipmentId, product: "diesel", subtotal: 50 }] });
    if (!theirs.ok) throw new Error("setup");
    expect(await updateFuelStop(db, actor(), theirs.id, { date: "2026-10-03", lines: [{ equipmentId: a.equipmentId, product: "diesel", subtotal: 1 }] }))
      .toMatchObject({ ok: false, code: "not-found" });
    expect((await listFuelStops(db, b.fleetId))[0]).toMatchObject({ total: 50 });
  });
});

describe("filtering fuel history", () => {
  it("filters by unit, year, month, and exact date, and sums spend per product for the filtered set", async () => {
    const fresh = await seedFleet(db, { userId: "user-c" });
    const c = { fleetId: fresh.fleetId, userId: "user-c" };
    const [reefer] = await db.insert(schema.equipment).values({ fleetId: c.fleetId, unitNumber: "R-9", normalizedUnitNumber: "R-9", type: "reefer" }).returning();
    const [other] = await db.insert(schema.equipment).values({ fleetId: c.fleetId, unitNumber: "9", normalizedUnitNumber: "9", type: "tractor" }).returning();
    const put = (date: string, lines: Parameters<typeof addFuelStop>[2]["lines"]) => addFuelStop(db, c, { date, lines });
    await put("2025-12-30", [{ equipmentId: fresh.equipmentId, product: "diesel", subtotal: 300 }]);
    await put("2026-03-10", [{ equipmentId: fresh.equipmentId, product: "diesel", subtotal: 200 }, { equipmentId: fresh.equipmentId, product: "def", subtotal: 15 }, { equipmentId: reefer.id, product: "reefer", subtotal: 60 }]);
    await put("2026-03-21", [{ equipmentId: other.id, product: "diesel", subtotal: 500 }]);

    const dates = async (f: Parameters<typeof listFuelStops>[2]) => (await listFuelStops(db, c.fleetId, f)).map((s) => s.date);
    expect(await dates({})).toEqual(["2026-03-21", "2026-03-10", "2025-12-30"]);
    expect(await dates({ equipmentId: reefer.id })).toEqual(["2026-03-10"]);
    expect(await dates({ year: 2026 })).toEqual(["2026-03-21", "2026-03-10"]);
    expect(await dates({ month: 12 })).toEqual(["2025-12-30"]);
    expect(await dates({ year: 2026, month: 3, date: "2026-03-10" })).toEqual(["2026-03-10"]);
    expect(await dates({ limit: 1 })).toEqual(["2026-03-21"]);
    expect(await dates({ equipmentId: "nope" })).toEqual([]);

    expect(await fuelSpendByProduct(db, c.fleetId)).toEqual({ diesel: 1000, def: 15, reefer: 60, total: 1075 });
    expect(await fuelSpendByProduct(db, c.fleetId, { year: 2026, month: 3 })).toEqual({ diesel: 700, def: 15, reefer: 60, total: 775 });
    expect(await fuelSpendByProduct(db, c.fleetId, { equipmentId: fresh.equipmentId })).toEqual({ diesel: 500, def: 15, reefer: 0, total: 515 });
    expect(await fuelSpendByProduct(db, a.fleetId, { equipmentId: other.id })).toEqual({ diesel: 0, def: 0, reefer: 0, total: 0 });
    expect(await fuelYears(db, c.fleetId)).toEqual([2026, 2025]);
    void truck2; void reeferId;
  });
});
