import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEquipment, getEquipment, listEquipment, updateEquipment, archiveEquipment } from "@/server/equipmentStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" });
  b = await seedFleet(db, { userId: "user-b" });
});
afterAll(() => close());

describe("equipment store", () => {
  it("creates a unit, normalizing the unit number for uniqueness but keeping the display value", async () => {
    const result = await createEquipment(db, a.fleetId, { unitNumber: " r-301 ", type: "reefer", make: "Thermo King" });
    expect(result).toMatchObject({ ok: true, equipment: { unitNumber: "r-301", type: "reefer" } });
  });

  it("reports a duplicate unit number instead of throwing", async () => {
    const result = await createEquipment(db, a.fleetId, { unitNumber: "R-301", type: "trailer" });
    expect(result).toEqual({ ok: false, code: "duplicate-unit", message: expect.stringContaining("R-301") });
  });

  it("rejects an empty unit number and an unknown type", async () => {
    expect(await createEquipment(db, a.fleetId, { unitNumber: "  ", type: "tractor" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createEquipment(db, a.fleetId, { unitNumber: "9", type: "boat" as never })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("never returns another fleet's equipment", async () => {
    expect(await getEquipment(db, a.fleetId, b.equipmentId)).toBeNull();
    expect((await listEquipment(db, a.fleetId)).map((e) => e.id)).not.toContain(b.equipmentId);
  });

  it("cannot update or archive another fleet's equipment", async () => {
    expect(await updateEquipment(db, a.fleetId, b.equipmentId, { notes: "hijack" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await archiveEquipment(db, a.fleetId, b.equipmentId)).toMatchObject({ ok: false, code: "not-found" });
  });

  it("hides archived units from the list but keeps them retrievable", async () => {
    const created = await createEquipment(db, a.fleetId, { unitNumber: "OLD-1", type: "trailer" });
    if (!created.ok) throw new Error("setup");
    await archiveEquipment(db, a.fleetId, created.equipment.id);
    expect((await listEquipment(db, a.fleetId)).map((e) => e.unitNumber)).not.toContain("OLD-1");
    expect(await getEquipment(db, a.fleetId, created.equipment.id)).toMatchObject({ unitNumber: "OLD-1" });
  });
});
