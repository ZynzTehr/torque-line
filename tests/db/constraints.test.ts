import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a", name: "Fleet A" });
  b = await seedFleet(db, { userId: "user-b", name: "Fleet B" });
});
afterAll(() => close());

const reading = (fleetId: string, equipmentId: string, extra: Partial<typeof schema.readings.$inferInsert> = {}) => ({
  fleetId, equipmentId, kind: "odometer" as const, value: 481000, observedAt: new Date(), createdBy: "user-a", ...extra,
});

describe("database-level fleet isolation", () => {
  it("accepts a reading for equipment in the same fleet", async () => {
    await expect(db.insert(schema.readings).values(reading(a.fleetId, a.equipmentId))).resolves.toBeDefined();
  });

  it("rejects a reading that points at another fleet's equipment", async () => {
    await expect(db.insert(schema.readings).values(reading(a.fleetId, b.equipmentId))).rejects.toThrow();
  });

  it("rejects cross-fleet links for schedules, service records, fuel lines and diagnostics too", async () => {
    await expect(db.insert(schema.maintenanceSchedules).values({
      fleetId: a.fleetId, equipmentId: b.equipmentId, name: "Oil", category: "PM-A", mileageInterval: 15000,
    })).rejects.toThrow();
    await expect(db.insert(schema.serviceRecords).values({
      fleetId: a.fleetId, equipmentId: b.equipmentId, date: "2026-10-01", serviceType: "Oil", createdBy: "user-a",
    })).rejects.toThrow();
    const [stop] = await db.insert(schema.fuelStops).values({ fleetId: a.fleetId, date: "2026-10-01", total: 100, createdBy: "user-a" }).returning();
    await expect(db.insert(schema.fuelLines).values({
      fleetId: a.fleetId, stopId: stop.id, equipmentId: b.equipmentId, product: "diesel", subtotal: 100,
    })).rejects.toThrow();
    await expect(db.insert(schema.diagnosticSessions).values({
      fleetId: a.fleetId, equipmentId: b.equipmentId, symptom: "Won't start", createdBy: "user-a",
    })).rejects.toThrow();
  });
});

describe("unit numbers", () => {
  it("are unique within a fleet after normalization", async () => {
    await expect(db.insert(schema.equipment).values({
      fleetId: a.fleetId, unitNumber: "101", normalizedUnitNumber: "101", type: "trailer",
    })).rejects.toThrow();
  });
  it("may repeat across fleets", async () => {
    // Both seeded fleets already hold unit 101; add 205 to each.
    for (const fleetId of [a.fleetId, b.fleetId]) {
      await expect(db.insert(schema.equipment).values({ fleetId, unitNumber: "205", normalizedUnitNumber: "205", type: "reefer" })).resolves.toBeDefined();
    }
  });
});

describe("reading rules", () => {
  it("refuses a confirmed-lower reading without a note", async () => {
    await expect(db.insert(schema.readings).values(reading(a.fleetId, a.equipmentId, { value: 100, confirmedLower: true }))).rejects.toThrow();
  });
  it("accepts a confirmed-lower reading that explains itself", async () => {
    await expect(db.insert(schema.readings).values(reading(a.fleetId, a.equipmentId, { value: 100, confirmedLower: true, note: "Odometer replaced" }))).resolves.toBeDefined();
  });
  it("refuses negative readings", async () => {
    await expect(db.insert(schema.readings).values(reading(a.fleetId, a.equipmentId, { value: -1 }))).rejects.toThrow();
  });
});

describe("other invariants", () => {
  it("allows one line per product per fuel stop", async () => {
    const [stop] = await db.insert(schema.fuelStops).values({ fleetId: a.fleetId, date: "2026-10-02", total: 0, createdBy: "user-a" }).returning();
    const line = { fleetId: a.fleetId, stopId: stop.id, equipmentId: a.equipmentId, product: "diesel" as const, subtotal: 10 };
    await db.insert(schema.fuelLines).values(line);
    await expect(db.insert(schema.fuelLines).values(line)).rejects.toThrow();
  });
  it("requires every PM schedule to have a mileage or time trigger", async () => {
    await expect(db.insert(schema.maintenanceSchedules).values({
      fleetId: a.fleetId, equipmentId: a.equipmentId, name: "Mystery", category: "PM-A",
    })).rejects.toThrow();
  });
});
