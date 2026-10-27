// Regression tests for defects confirmed by the adversarial review (see the phase-5 PR).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { addFuelStop } from "@/server/fuelStore";
import { getEquipment } from "@/server/equipmentStore";
import { recordReading } from "@/server/readingsStore";
import { applyDefaultSchedule, listSchedules } from "@/server/scheduleStore";
import { logService } from "@/server/serviceStore";
import { createSession, getSession, markCause, replaceCauses } from "@/server/diagnosticsStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
const actor = () => ({ fleetId: a.fleetId, userId: "user-a" });
const unit = async (id = a.equipmentId) => (await getEquipment(db, a.fleetId, id))!;
// Calendar day in the fleet's time zone (seeded fleets use America/Chicago), as the app's date inputs produce.
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const cause = (name: string, over: object = {}) => ({ name, likelihood: "medium" as const, why: "w", how_to_check: "c", cost_tier: "low" as const, safety_critical: false, needs_shop: false, tried: false, ...over });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" }); // tractor at 480,000, America/Chicago
});
afterAll(() => close());

describe("input bounds", () => {
  it("rejects fuel amounts beyond the database's numeric precision instead of failing with a 500", async () => {
    for (const line of [{ subtotal: 20_000_000_000 }, { subtotal: 10, gallons: 10_000_000 }, { subtotal: 10, pricePerGallon: 100_000 }]) {
      expect(await addFuelStop(db, actor(), { date: isoDay(0), lines: [{ equipmentId: a.equipmentId, product: "diesel", ...line }] }))
        .toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("rejects service and fuel meter readings outside the supported range", async () => {
    expect(await logService(db, actor(), { equipmentId: a.equipmentId, date: isoDay(0), serviceType: "Oil", reading: 48_215_000 }))
      .toMatchObject({ ok: false, code: "invalid" });
    expect(await addFuelStop(db, actor(), { date: isoDay(0), lines: [{ equipmentId: a.equipmentId, product: "diesel", subtotal: 10, odometer: 12_345_678_901 }] }))
      .toMatchObject({ ok: false, code: "invalid" });
    expect((await unit()).currentMileage).toBe(480000);
  });

  it("rejects service and fuel dates more than a day in the future", async () => {
    expect(await logService(db, actor(), { equipmentId: a.equipmentId, date: isoDay(3), serviceType: "Oil" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await addFuelStop(db, actor(), { date: isoDay(3), lines: [{ equipmentId: a.equipmentId, product: "diesel", subtotal: 10 }] }))
      .toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("schedule baselines", () => {
  it("a backfilled older service does not roll a schedule's baseline back", async () => {
    await applyDefaultSchedule(db, a.fleetId, a.equipmentId);
    const [pm] = await listSchedules(db, a.fleetId, a.equipmentId);
    await logService(db, actor(), { equipmentId: a.equipmentId, scheduleId: pm.id, date: "2026-09-01", reading: 478000 });
    await logService(db, actor(), { equipmentId: a.equipmentId, scheduleId: pm.id, date: "2026-03-01", reading: 460000, confirmDuplicate: true });
    const after = (await listSchedules(db, a.fleetId, a.equipmentId)).find((s) => s.id === pm.id)!;
    expect(after).toMatchObject({ lastServiceDate: "2026-09-01", lastServiceMileage: 478000 });
  });

  it("completing a mileage schedule without a reading uses the unit's current mileage as the new baseline", async () => {
    const [, second] = await listSchedules(db, a.fleetId, a.equipmentId);
    await logService(db, actor(), { equipmentId: a.equipmentId, scheduleId: second.id, date: isoDay(0) });
    const after = (await listSchedules(db, a.fleetId, a.equipmentId)).find((s) => s.id === second.id)!;
    expect(after.lastServiceMileage).toBe((await unit()).currentMileage);
  });
});

describe("same-day evidence", () => {
  it("a same-day fuel receipt after an ordinary manual reading still moves the meter forward", async () => {
    const [t] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "SD-1", normalizedUnitNumber: "SD-1", type: "tractor" }).returning();
    const morning = new Date(`${isoDay(0)}T14:00:00Z`); // 09:00 in Chicago, earlier the same fleet day
    await recordReading(db, actor(), { equipmentId: t.id, value: 482000, observedAt: morning });
    await addFuelStop(db, actor(), { date: isoDay(0), lines: [{ equipmentId: t.id, product: "diesel", subtotal: 100, odometer: 482180 }] });
    expect((await unit(t.id)).currentMileage).toBe(482180);
  });

  it("but never undoes a same-day confirmed correction", async () => {
    const [t] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "SD-2", normalizedUnitNumber: "SD-2", type: "tractor", currentMileage: 482150 }).returning();
    await recordReading(db, actor(), { equipmentId: t.id, value: 470000, confirmLower: true, note: "Cluster replaced" });
    await logService(db, actor(), { equipmentId: t.id, date: isoDay(0), serviceType: "Oil", reading: 482150 });
    expect((await unit(t.id)).currentMileage).toBe(470000);
  });
});

describe("diagnosis cause state", () => {
  it("keeps tried causes the model dropped, and keeps a tried mark made during a re-rank", async () => {
    const s = await createSession(db, actor(), { equipmentId: a.equipmentId, symptom: "power loss" });
    if (!s.ok) throw new Error("setup");
    await replaceCauses(db, a.fleetId, s.session.id, [cause("Fuel filter"), cause("Lift pump")]);
    let view = (await getSession(db, a.fleetId, s.session.id))!;
    await markCause(db, a.fleetId, view.causes.find((c) => c.name === "Fuel filter")!.id, "tried");
    await markCause(db, a.fleetId, view.causes.find((c) => c.name === "Lift pump")!.id, "tried"); // marked while the model was thinking
    // The model's answer was computed before "Lift pump" was marked, and it dropped "Fuel filter".
    await replaceCauses(db, a.fleetId, s.session.id, [cause("Lift pump", { tried: false }), cause("Injector")]);
    view = (await getSession(db, a.fleetId, s.session.id))!;
    const byName = Object.fromEntries(view.causes.map((c) => [c.name, c.tried]));
    expect(byName).toEqual({ "Lift pump": true, Injector: false, "Fuel filter": true });
    expect(view.causes.filter((c) => c.name === "Lift pump")).toHaveLength(1);
  });
});

void eq;
