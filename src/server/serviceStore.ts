import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { validDate } from "@/domain/fuel";
import { findSimilarServiceRecord } from "@/domain/serviceRecords";
import type { AppDb } from "./fleetStore";
import { getEquipment } from "./equipmentStore";
import { invalid, notFound, type Actor, type Failure } from "./result";
import { advanceMeterFromEvidence, lockUnits, notTooFarAhead } from "./readingsStore";
import { checkReading } from "@/domain/readings";

export type ServiceRecordRow = typeof schema.serviceRecords.$inferSelect;

const serviceInput = z.object({
  equipmentId: z.string(),
  scheduleId: z.string().optional(),
  date: z.string().refine(validDate, "Enter a valid service date.").refine(notTooFarAhead, "Service dates can't be in the future."),
  serviceType: z.string().trim().max(160).optional(),
  reading: z.number().int().nonnegative("Readings can't be negative.").optional(),
  cost: z.number().nonnegative("Cost can't be negative.").max(9_999_999_999.99).optional(),
  shop: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(4000).optional(),
  confirmDuplicate: z.boolean().optional(),
});
export type ServiceInput = z.input<typeof serviceInput>;

export type LogServiceResult =
  | { ok: true; record: ServiceRecordRow }
  | { ok: false; code: "possible-duplicate"; existing: Pick<ServiceRecordRow, "id" | "date" | "serviceType" | "cost"> }
  | Failure;

export async function listServiceRecords(db: AppDb, fleetId: string, equipmentId: string): Promise<ServiceRecordRow[]> {
  if (!z.uuid().safeParse(equipmentId).success) return [];
  return db.select().from(schema.serviceRecords)
    .where(and(eq(schema.serviceRecords.fleetId, fleetId), eq(schema.serviceRecords.equipmentId, equipmentId)))
    .orderBy(desc(schema.serviceRecords.date), desc(schema.serviceRecords.createdAt));
}

/**
 * Save a service record. With a scheduleId it also resets that schedule's baseline (date and meter).
 * A reading at or above the unit's current value moves the unit forward; a lower one stays on the record only.
 * Same unit, same day, same normalized service type asks for confirmation first.
 */
export async function logService(db: AppDb, actor: Actor, input: ServiceInput): Promise<LogServiceResult> {
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const d = parsed.data;
  const unit = await getEquipment(db, actor.fleetId, d.equipmentId);
  if (!unit) return notFound("That unit");

  let schedule: typeof schema.maintenanceSchedules.$inferSelect | undefined;
  if (d.scheduleId) {
    if (!z.uuid().safeParse(d.scheduleId).success) return notFound("That schedule item");
    [schedule] = await db.select().from(schema.maintenanceSchedules).where(and(
      eq(schema.maintenanceSchedules.fleetId, actor.fleetId),
      eq(schema.maintenanceSchedules.equipmentId, unit.id),
      eq(schema.maintenanceSchedules.id, d.scheduleId),
    ));
    if (!schedule) return notFound("That schedule item");
  }
  const serviceType = d.serviceType || schedule?.name;
  if (!serviceType) return invalid("Describe the service.");

  if (!d.confirmDuplicate) {
    const similar = findSimilarServiceRecord({ equipmentId: unit.id, date: d.date, serviceType }, await listServiceRecords(db, actor.fleetId, unit.id));
    if (similar) return { ok: false, code: "possible-duplicate", existing: { id: similar.id, date: similar.date, serviceType: similar.serviceType, cost: similar.cost } };
  }

  const isReefer = unit.type === "reefer";
  const meterReading = unit.type === "trailer" ? undefined : d.reading;
  if (meterReading != null) {
    const check = checkReading(null, meterReading, isReefer ? "hours" : "odometer");
    if (check.kind === "invalid") return invalid(check.message);
  }
  return db.transaction(async (tx) => {
    await lockUnits(tx, actor.fleetId, [unit.id]);
    const [record] = await tx.insert(schema.serviceRecords).values({
      fleetId: actor.fleetId, equipmentId: unit.id, scheduleId: schedule?.id ?? null, date: d.date, serviceType,
      mileage: isReefer ? null : meterReading ?? null, hours: isReefer ? meterReading ?? null : null,
      cost: d.cost ?? null, shop: d.shop || null, notes: d.notes || null, createdBy: actor.userId,
    }).returning();

    // Only a service at least as recent as the schedule's last one moves its baseline; backfills don't roll it back.
    if (schedule && (!schedule.lastServiceDate || d.date >= schedule.lastServiceDate)) {
      let baseline = meterReading;
      if (baseline == null && !isReefer && schedule.mileageInterval != null) {
        const [locked] = await tx.select({ m: schema.equipment.currentMileage }).from(schema.equipment)
          .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, unit.id)));
        baseline = locked?.m ?? undefined; // completing a mileage item without a reading: use the unit's current mileage
      }
      await tx.update(schema.maintenanceSchedules).set({
        lastServiceDate: d.date,
        ...(baseline != null && (isReefer ? { lastServiceHours: baseline } : { lastServiceMileage: baseline })),
        updatedAt: new Date(),
      }).where(and(eq(schema.maintenanceSchedules.fleetId, actor.fleetId), eq(schema.maintenanceSchedules.id, schedule.id)));
    }

    if (meterReading != null) {
      await advanceMeterFromEvidence(tx, actor, { equipmentId: unit.id, value: meterReading, date: d.date, source: "service" });
    }
    return { ok: true as const, record };
  });
}

const editInput = serviceInput.omit({ equipmentId: true, scheduleId: true })
  .extend({ scheduleId: z.string().nullable().optional() });
export type ServiceEditInput = z.input<typeof editInput>;

type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

async function getRecord(db: AppDb | Tx, fleetId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(schema.serviceRecords)
    .where(and(eq(schema.serviceRecords.fleetId, fleetId), eq(schema.serviceRecords.id, id)));
  return row ?? null;
}

/**
 * Set a schedule item's baseline from the latest service still linked to it, or clear it when none is left.
 * A linked record without a reading takes the unit's last recorded reading on or before that day.
 */
async function recomputeBaseline(tx: Tx, fleetId: string, scheduleId: string) {
  const [latest] = await tx.select().from(schema.serviceRecords)
    .where(and(eq(schema.serviceRecords.fleetId, fleetId), eq(schema.serviceRecords.scheduleId, scheduleId)))
    .orderBy(desc(schema.serviceRecords.date), desc(schema.serviceRecords.createdAt)).limit(1);
  const where = and(eq(schema.maintenanceSchedules.fleetId, fleetId), eq(schema.maintenanceSchedules.id, scheduleId));
  if (!latest) {
    await tx.update(schema.maintenanceSchedules)
      .set({ lastServiceDate: null, lastServiceMileage: null, lastServiceHours: null, updatedAt: new Date() }).where(where);
    return;
  }
  let mileage = latest.mileage;
  let hours = latest.hours;
  if (mileage == null && hours == null) {
    const [prior] = await tx.select({ kind: schema.readings.kind, value: schema.readings.value }).from(schema.readings)
      .where(and(eq(schema.readings.fleetId, fleetId), eq(schema.readings.equipmentId, latest.equipmentId),
        sql`${schema.readings.observedAt}::date <= ${latest.date}`))
      .orderBy(desc(schema.readings.observedAt), desc(schema.readings.createdAt)).limit(1);
    if (prior?.kind === "hours") hours = prior.value; else if (prior) mileage = prior.value;
  }
  await tx.update(schema.maintenanceSchedules)
    .set({ lastServiceDate: latest.date, lastServiceMileage: mileage, lastServiceHours: hours, updatedAt: new Date() }).where(where);
}

/**
 * Replace a record's editable fields. The unit stays the same. A same-day duplicate (other than this record)
 * asks first, a higher reading moves the unit forward, and every schedule item the record was or is now
 * linked to gets its baseline recomputed from its remaining services.
 */
export async function updateServiceRecord(db: AppDb, actor: Actor, id: string, input: ServiceEditInput): Promise<LogServiceResult> {
  const existing = await getRecord(db, actor.fleetId, id);
  if (!existing) return notFound("That service record");
  const parsed = editInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const d = parsed.data;
  const unit = await getEquipment(db, actor.fleetId, existing.equipmentId);
  if (!unit) return notFound("That unit");

  let schedule: typeof schema.maintenanceSchedules.$inferSelect | undefined;
  if (d.scheduleId) {
    if (!z.uuid().safeParse(d.scheduleId).success) return notFound("That schedule item");
    [schedule] = await db.select().from(schema.maintenanceSchedules).where(and(
      eq(schema.maintenanceSchedules.fleetId, actor.fleetId),
      eq(schema.maintenanceSchedules.equipmentId, unit.id),
      eq(schema.maintenanceSchedules.id, d.scheduleId),
    ));
    if (!schedule) return notFound("That schedule item");
  }
  const serviceType = d.serviceType || schedule?.name;
  if (!serviceType) return invalid("Describe the service.");

  if (!d.confirmDuplicate) {
    const similar = findSimilarServiceRecord({ id, equipmentId: unit.id, date: d.date, serviceType }, await listServiceRecords(db, actor.fleetId, unit.id));
    if (similar) return { ok: false, code: "possible-duplicate", existing: { id: similar.id, date: similar.date, serviceType: similar.serviceType, cost: similar.cost } };
  }

  const isReefer = unit.type === "reefer";
  const meterReading = unit.type === "trailer" ? undefined : d.reading;
  if (meterReading != null) {
    const check = checkReading(null, meterReading, isReefer ? "hours" : "odometer");
    if (check.kind === "invalid") return invalid(check.message);
  }
  return db.transaction(async (tx) => {
    await lockUnits(tx, actor.fleetId, [unit.id]);
    const [record] = await tx.update(schema.serviceRecords).set({
      scheduleId: schedule?.id ?? null, date: d.date, serviceType,
      mileage: isReefer ? null : meterReading ?? null, hours: isReefer ? meterReading ?? null : null,
      cost: d.cost ?? null, shop: d.shop || null, notes: d.notes || null, updatedAt: new Date(),
    }).where(and(eq(schema.serviceRecords.fleetId, actor.fleetId), eq(schema.serviceRecords.id, id))).returning();
    for (const sid of new Set([existing.scheduleId, schedule?.id].filter((v): v is string => !!v))) {
      await recomputeBaseline(tx, actor.fleetId, sid);
    }
    if (meterReading != null) {
      await advanceMeterFromEvidence(tx, actor, { equipmentId: unit.id, value: meterReading, date: d.date, source: "service" });
    }
    return { ok: true as const, record };
  });
}

/** Delete a record. The schedule item it completed falls back to its previous service. Meter readings stay. */
export async function deleteServiceRecord(db: AppDb, fleetId: string, id: string): Promise<{ ok: true } | Failure> {
  const existing = await getRecord(db, fleetId, id);
  if (!existing) return notFound("That service record");
  await db.transaction(async (tx) => {
    await tx.delete(schema.serviceRecords).where(and(eq(schema.serviceRecords.fleetId, fleetId), eq(schema.serviceRecords.id, id)));
    if (existing.scheduleId) await recomputeBaseline(tx, fleetId, existing.scheduleId);
  });
  return { ok: true };
}

export interface FleetServiceFilter { equipmentId?: string; from?: string; to?: string; limit?: number }

/** Every service record in the fleet, newest first, with its unit. Removed units' records are kept. */
export async function listFleetServiceRecords(db: AppDb, fleetId: string, filter: FleetServiceFilter = {}) {
  const conditions = [eq(schema.serviceRecords.fleetId, fleetId)];
  if (filter.equipmentId) {
    if (!z.uuid().safeParse(filter.equipmentId).success) return [];
    conditions.push(eq(schema.serviceRecords.equipmentId, filter.equipmentId));
  }
  if (filter.from && validDate(filter.from)) conditions.push(gte(schema.serviceRecords.date, filter.from));
  if (filter.to && validDate(filter.to)) conditions.push(lte(schema.serviceRecords.date, filter.to));
  const rows = await db.select({
    record: schema.serviceRecords, unitNumber: schema.equipment.unitNumber, unitType: schema.equipment.type,
    unitRemoved: sql<boolean>`${schema.equipment.archivedAt} is not null`,
  }).from(schema.serviceRecords)
    .innerJoin(schema.equipment, eq(schema.equipment.id, schema.serviceRecords.equipmentId))
    .where(and(...conditions))
    .orderBy(desc(schema.serviceRecords.date), desc(schema.serviceRecords.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 100, 1), 1000));
  return rows.map((r) => ({ ...r.record, unitNumber: r.unitNumber, unitType: r.unitType, unitRemoved: r.unitRemoved }));
}

/** Total recorded service spend for a fleet, summed in Postgres numeric (no float drift). */
export async function fleetServiceSpend(db: AppDb, fleetId: string): Promise<number> {
  const [row] = await db.select({ total: sql<string | null>`sum(${schema.serviceRecords.cost})` })
    .from(schema.serviceRecords).where(eq(schema.serviceRecords.fleetId, fleetId));
  return Number(row?.total ?? 0);
}
