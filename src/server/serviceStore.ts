import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { validDate } from "@/domain/fuel";
import { findSimilarServiceRecord } from "@/domain/serviceRecords";
import type { AppDb } from "./fleetStore";
import { getEquipment } from "./equipmentStore";
import { invalid, notFound, type Actor, type Failure } from "./result";

export type ServiceRecordRow = typeof schema.serviceRecords.$inferSelect;

const serviceInput = z.object({
  equipmentId: z.string(),
  scheduleId: z.string().optional(),
  date: z.string().refine(validDate, "Enter a valid service date."),
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
  return db.transaction(async (tx) => {
    const [record] = await tx.insert(schema.serviceRecords).values({
      fleetId: actor.fleetId, equipmentId: unit.id, date: d.date, serviceType,
      mileage: isReefer ? null : meterReading ?? null, hours: isReefer ? meterReading ?? null : null,
      cost: d.cost ?? null, shop: d.shop || null, notes: d.notes || null, createdBy: actor.userId,
    }).returning();

    if (schedule) {
      await tx.update(schema.maintenanceSchedules).set({
        lastServiceDate: d.date,
        ...(meterReading != null && (isReefer ? { lastServiceHours: meterReading } : { lastServiceMileage: meterReading })),
        updatedAt: new Date(),
      }).where(and(eq(schema.maintenanceSchedules.fleetId, actor.fleetId), eq(schema.maintenanceSchedules.id, schedule.id)));
    }

    if (meterReading != null) {
      const [locked] = await tx.select().from(schema.equipment)
        .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, unit.id))).for("update");
      const current = isReefer ? locked.currentHours : locked.currentMileage;
      if (current == null || meterReading >= current) {
        const observedAt = new Date(`${d.date}T12:00:00Z`);
        await tx.insert(schema.readings).values({
          fleetId: actor.fleetId, equipmentId: unit.id, kind: isReefer ? "hours" : "odometer", value: meterReading,
          observedAt, source: "service", createdBy: actor.userId,
        });
        await tx.update(schema.equipment).set(isReefer
          ? { currentHours: meterReading, readingUpdatedAt: new Date(), updatedAt: new Date() }
          : { currentMileage: meterReading, readingUpdatedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, unit.id)));
      }
    }
    return { ok: true as const, record };
  });
}
