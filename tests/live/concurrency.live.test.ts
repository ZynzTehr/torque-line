// Concurrency on real Neon Postgres (PGlite runs one connection and cannot deadlock).
// Run: set -a; . ./.env.local; set +a; LIVE=1 npx vitest run tests/live
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addFuelStop } from "@/server/fuelStore";
import { logService } from "@/server/serviceStore";
import { getEquipment } from "@/server/equipmentStore";

const live = Boolean(process.env.LIVE && process.env.DATABASE_URL);
const db = live ? getDb() : (null as never);
let fleetId = "";
let unitId = "";

describe.skipIf(!live)("concurrent saves on one unit (live Neon)", () => {
  beforeAll(async () => {
    const owner = `live-concurrency-${Date.now()}`;
    const [fleet] = await db.insert(schema.fleets).values({ ownerUserId: owner, name: "Concurrency test" }).returning();
    fleetId = fleet.id;
    const [unit] = await db.insert(schema.equipment).values({ fleetId, unitNumber: "C-1", normalizedUnitNumber: "C-1", type: "tractor", currentMileage: 100000 }).returning();
    unitId = unit.id;
  });
  afterAll(async () => {
    if (fleetId) await db.delete(schema.fleets).where(eq(schema.fleets.id, fleetId)); // cascades to all child rows
  });

  it("service logs and fuel stops with readings on the same unit all succeed, with no deadlock", async () => {
    const actor = { fleetId, userId: "live-test" };
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const ops = Array.from({ length: 12 }, (_, i) => i % 2 === 0
      ? logService(db, actor, { equipmentId: unitId, date: day, serviceType: `Check ${i}`, reading: 100000 + i * 10 })
      : addFuelStop(db, actor, { date: day, lines: [{ equipmentId: unitId, product: "diesel", subtotal: 50 + i, odometer: 100000 + i * 10 }] }));
    const results = await Promise.allSettled(ops);
    const failures = results.filter((r) => r.status === "rejected" || !r.value.ok);
    expect(failures.map((f) => (f.status === "rejected" ? String((f.reason as { code?: string })?.code ?? f.reason) : JSON.stringify(f.value)))).toEqual([]);
    expect((await getEquipment(db, fleetId, unitId))?.currentMileage).toBe(100110);
  }, 60_000);
});
