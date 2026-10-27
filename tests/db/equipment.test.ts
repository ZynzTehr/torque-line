import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
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

  it("removes a unit from the fleet, accepts nothing new for it, and frees its number", async () => {
    const created = await createEquipment(db, a.fleetId, { unitNumber: "OLD-1", type: "trailer" });
    if (!created.ok) throw new Error("setup");
    expect(await archiveEquipment(db, a.fleetId, created.equipment.id)).toEqual({ ok: true });
    expect((await listEquipment(db, a.fleetId)).map((e) => e.unitNumber)).not.toContain("OLD-1");
    expect(await getEquipment(db, a.fleetId, created.equipment.id)).toBeNull();
    expect(await updateEquipment(db, a.fleetId, created.equipment.id, { notes: "x" })).toMatchObject({ ok: false, code: "not-found" });
    const reused = await createEquipment(db, a.fleetId, { unitNumber: "old-1", type: "tractor" });
    expect(reused).toMatchObject({ ok: true, equipment: { unitNumber: "old-1" } });
    expect(await db.select().from(schema.equipment).where(eq(schema.equipment.normalizedUnitNumber, "OLD-1"))).toHaveLength(2);
  });

  it("edits a unit's details and reports a clash with another unit's number", async () => {
    const created = await createEquipment(db, a.fleetId, { unitNumber: "E-7", type: "tractor" });
    if (!created.ok) throw new Error("setup");
    expect(await updateEquipment(db, a.fleetId, created.equipment.id, { unitNumber: "E-8", make: "Kenworth", notes: "New clutch 2026" }))
      .toMatchObject({ ok: true, equipment: { unitNumber: "E-8", make: "Kenworth", notes: "New clutch 2026" } });
    expect(await updateEquipment(db, a.fleetId, created.equipment.id, { unitNumber: "old-1" })).toMatchObject({ ok: false, code: "duplicate-unit" });
  });
});
