import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { unitCosts, validateFuelPurchase, type FuelPurchase } from "@/domain/fuel";
import type { AppDb } from "./fleetStore";
import { getEquipment } from "./equipmentStore";
import { invalid, notFound, type Actor, type Failure } from "./result";
import { listServiceRecords } from "./serviceStore";
import { advanceMeterFromEvidence, lockUnits, notTooFarAhead } from "./readingsStore";
import { MAX_HOURS, MAX_ODOMETER } from "@/domain/readings";

const lineInput = z.object({
  equipmentId: z.string(),
  product: z.enum(["diesel", "def", "reefer"]),
  // Upper bounds match the column precision: numeric(10,3), numeric(8,3), numeric(12,2), and the meter ranges.
  gallons: z.number().nonnegative().max(9_999_999.999, "That gallon amount is too large.").optional(),
  pricePerGallon: z.number().nonnegative().max(99_999.999, "That price per gallon is too large.").optional(),
  subtotal: z.number().nonnegative().max(9_999_999_999.99, "That amount is too large."),
  odometer: z.number().int().nonnegative().max(MAX_ODOMETER, "Odometer readings above 9,999,999 aren't supported.").optional(),
  hours: z.number().int().nonnegative().max(MAX_HOURS, "Hour readings above 999,999 aren't supported.").optional(),
});
const stopInput = z.object({
  date: z.string().refine(notTooFarAhead, "Fuel dates can't be in the future."),
  station: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineInput).min(1, "Enter at least one fuel product.").max(3),
});
export type FuelStopInput = z.input<typeof stopInput>;

/**
 * Record one fuel stop. Product rules come from the ported FleetPulse validator: one line per product,
 * diesel and DEF on one tractor, reefer fuel on a reefer; the stop total is the sum of its lines.
 * Odometer and hour readings on lines move the unit's meter forward, never backward.
 */
export async function addFuelStop(db: AppDb, actor: Actor, input: FuelStopInput): Promise<{ ok: true; id: string } | Failure> {
  const parsed = stopInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const d = parsed.data;
  const ids = [...new Set(d.lines.map((l) => l.equipmentId))];
  const units = await Promise.all(ids.map((id) => getEquipment(db, actor.fleetId, id)));
  if (units.some((u) => !u)) return notFound("A unit on this fuel stop");
  const equipment = units.map((u) => ({ id: u!.id, unitNumber: u!.unitNumber, type: u!.type }));

  let purchase: FuelPurchase;
  try {
    purchase = validateFuelPurchase({
      date: d.date, location: d.station ?? "", notes: d.notes ?? "",
      items: d.lines.map((l) => ({ equipmentId: l.equipmentId, fuelType: l.product, gallons: l.gallons ?? null,
        pricePerGallon: l.pricePerGallon ?? null, totalCost: l.subtotal, odometer: l.odometer ?? null, hours: l.hours ?? null })),
    }, equipment) as FuelPurchase;
  } catch (error) {
    return invalid((error as Error).message);
  }

  if (purchase.totalCost > 9_999_999_999.99) return invalid("That fuel stop total is too large.");

  return db.transaction(async (tx) => {
    await lockUnits(tx, actor.fleetId, ids);
    const [stop] = await tx.insert(schema.fuelStops).values({
      fleetId: actor.fleetId, date: purchase.date, station: purchase.location || null, notes: purchase.notes || null,
      total: purchase.totalCost, createdBy: actor.userId,
    }).returning({ id: schema.fuelStops.id });
    await tx.insert(schema.fuelLines).values(purchase.items.map((it) => ({
      fleetId: actor.fleetId, stopId: stop.id, equipmentId: String(it.equipmentId), product: it.fuelType,
      gallons: it.gallons, pricePerGallon: it.pricePerGallon, subtotal: it.totalCost, odometer: it.odometer, hours: it.hours,
    })));

    for (const it of purchase.items) {
      const reading = it.fuelType === "reefer" ? it.hours : it.odometer;
      if (reading == null) continue;
      await advanceMeterFromEvidence(tx, actor, { equipmentId: String(it.equipmentId), value: reading, date: purchase.date, source: "fuel" });
    }
    return { ok: true as const, id: stop.id };
  });
}

export async function listFuelStops(db: AppDb, fleetId: string, limit = 50) {
  const stops = await db.select().from(schema.fuelStops).where(eq(schema.fuelStops.fleetId, fleetId))
    .orderBy(desc(schema.fuelStops.date), desc(schema.fuelStops.createdAt)).limit(limit);
  if (!stops.length) return [];
  const lines = await db.select({
    stopId: schema.fuelLines.stopId, equipmentId: schema.fuelLines.equipmentId, product: schema.fuelLines.product,
    gallons: schema.fuelLines.gallons, subtotal: schema.fuelLines.subtotal, unitNumber: schema.equipment.unitNumber,
  }).from(schema.fuelLines)
    .innerJoin(schema.equipment, eq(schema.equipment.id, schema.fuelLines.equipmentId))
    .where(and(eq(schema.fuelLines.fleetId, fleetId), inArray(schema.fuelLines.stopId, stops.map((s) => s.id))));
  return stops.map((s) => ({ ...s, lines: lines.filter((l) => l.stopId === s.id) }));
}

export async function deleteFuelStop(db: AppDb, fleetId: string, id: string): Promise<{ ok: true } | Failure> {
  if (!z.uuid().safeParse(id).success) return notFound("That fuel stop");
  const removed = await db.delete(schema.fuelStops)
    .where(and(eq(schema.fuelStops.fleetId, fleetId), eq(schema.fuelStops.id, id))).returning({ id: schema.fuelStops.id });
  return removed.length ? { ok: true } : notFound("That fuel stop");
}

/** Service and fuel spend for one unit, and cost per mile (tractors) or per hour (reefers) over tracked distance. */
export async function unitCostSummary(db: AppDb, fleetId: string, equipmentId: string) {
  const unit = await getEquipment(db, fleetId, equipmentId);
  if (!unit) return null;
  const [records, lines] = await Promise.all([
    listServiceRecords(db, fleetId, equipmentId),
    db.select({ subtotal: schema.fuelLines.subtotal, odometer: schema.fuelLines.odometer, hours: schema.fuelLines.hours, date: schema.fuelStops.date })
      .from(schema.fuelLines).innerJoin(schema.fuelStops, eq(schema.fuelStops.id, schema.fuelLines.stopId))
      .where(and(eq(schema.fuelLines.fleetId, fleetId), eq(schema.fuelLines.equipmentId, equipmentId))),
  ]);
  return unitCosts(
    { id: unit.id, unitNumber: unit.unitNumber, type: unit.type, currentMileage: unit.currentMileage, currentHours: unit.currentHours },
    records.map((r) => ({ date: r.date, cost: r.cost, mileage: r.mileage, hours: r.hours })),
    lines.map((l) => ({ date: l.date, totalCost: l.subtotal, odometer: l.odometer, hours: l.hours })),
  );
}

/** Total recorded fuel spend for a fleet (sum of stop totals, each counted once). */
export async function fleetFuelSpend(db: AppDb, fleetId: string): Promise<number> {
  const [row] = await db.select({ total: sql<string | null>`sum(${schema.fuelStops.total})` })
    .from(schema.fuelStops).where(eq(schema.fuelStops.fleetId, fleetId));
  return Number(row?.total ?? 0);
}
