import { and, desc, eq, sql } from "drizzle-orm";
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
      fleetId: actor.fleetId, equipmentId: unit.id, date: d.date, serviceType,
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

/** Total recorded service spend for a fleet, summed in Postgres numeric (no float drift). */
export async function fleetServiceSpend(db: AppDb, fleetId: string): Promise<number> {
  const [row] = await db.select({ total: sql<string | null>`sum(${schema.serviceRecords.cost})` })
    .from(schema.serviceRecords).where(eq(schema.serviceRecords.fleetId, fleetId));
  return Number(row?.total ?? 0);
}
