import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { getDefaultMaintenanceItems } from "@/domain/templates";
import type { AppDb } from "./fleetStore";
import { getEquipment } from "./equipmentStore";
import { invalid, notFound, type Failure } from "./result";

export type ScheduleRow = typeof schema.maintenanceSchedules.$inferSelect;

const interval = z.number().int().positive().max(2_000_000).nullable().optional();
const scheduleFields = z.object({
  name: z.string().trim().min(1, "Name the service.").max(120),
  category: z.enum(["PM-A", "PM-B", "PM-C", "Annual"]),
  description: z.string().trim().max(1000).nullable().optional(),
  mileageInterval: interval,
  /** Days between services. */
  timeInterval: interval,
  enabled: z.boolean().optional(),
  source: z.enum(["manual", "template", "ai_accepted"]).optional(),
  sourceDetail: z.string().trim().max(500).nullable().optional(),
});
export type ScheduleInput = z.input<typeof scheduleFields>;

function checkTriggers(type: string, mileage: number | null | undefined, days: number | null | undefined): Failure | null {
  if (mileage == null && days == null) return invalid("Set a mileage interval, a time interval, or both.");
  if (mileage != null && type !== "tractor") return invalid("Only tractors have an odometer. Use a time interval for trailers and reefers.");
  return null;
}

export async function listSchedules(db: AppDb, fleetId: string, equipmentId: string): Promise<ScheduleRow[]> {
  if (!z.uuid().safeParse(equipmentId).success) return [];
  return db.select().from(schema.maintenanceSchedules)
    .where(and(eq(schema.maintenanceSchedules.fleetId, fleetId), eq(schema.maintenanceSchedules.equipmentId, equipmentId)))
    .orderBy(asc(schema.maintenanceSchedules.category), asc(schema.maintenanceSchedules.name));
}

export async function listFleetSchedules(db: AppDb, fleetId: string): Promise<ScheduleRow[]> {
  return db.select().from(schema.maintenanceSchedules).where(eq(schema.maintenanceSchedules.fleetId, fleetId));
}

/** Adds the unit type's default PM schedule if the unit has none yet; safe to call repeatedly. */
export async function applyDefaultSchedule(db: AppDb, fleetId: string, equipmentId: string): Promise<{ ok: true; added: number } | Failure> {
  const unit = await getEquipment(db, fleetId, equipmentId);
  if (!unit) return notFound("That unit");
  if ((await listSchedules(db, fleetId, equipmentId)).length) return { ok: true, added: 0 };
  const items = getDefaultMaintenanceItems(unit.type).map((t) => ({
    fleetId, equipmentId, name: t.name, category: t.category, description: t.description,
    mileageInterval: unit.type === "tractor" ? t.mileageInterval : null,
    timeIntervalDays: t.timeInterval, source: "template" as const,
  })).filter((t) => t.mileageInterval != null || t.timeIntervalDays != null);
  if (items.length) await db.insert(schema.maintenanceSchedules).values(items);
  return { ok: true, added: items.length };
}

export async function addSchedule(db: AppDb, fleetId: string, equipmentId: string, input: ScheduleInput):
  Promise<{ ok: true; schedule: ScheduleRow } | Failure> {
  const unit = await getEquipment(db, fleetId, equipmentId);
  if (!unit) return notFound("That unit");
  const parsed = scheduleFields.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const d = parsed.data;
  const problem = checkTriggers(unit.type, d.mileageInterval, d.timeInterval);
  if (problem) return problem;
  const [schedule] = await db.insert(schema.maintenanceSchedules).values({
    fleetId, equipmentId, name: d.name, category: d.category, description: d.description ?? null,
    mileageInterval: d.mileageInterval ?? null, timeIntervalDays: d.timeInterval ?? null,
    enabled: d.enabled ?? true, source: d.source ?? "manual", sourceDetail: d.sourceDetail ?? null,
  }).returning();
  return { ok: true, schedule };
}

async function getSchedule(db: AppDb, fleetId: string, id: string): Promise<ScheduleRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(schema.maintenanceSchedules)
    .where(and(eq(schema.maintenanceSchedules.fleetId, fleetId), eq(schema.maintenanceSchedules.id, id)));
  return row ?? null;
}

export async function updateSchedule(db: AppDb, fleetId: string, id: string, input: Partial<ScheduleInput>):
  Promise<{ ok: true; schedule: ScheduleRow } | Failure> {
  const existing = await getSchedule(db, fleetId, id);
  if (!existing) return notFound("That schedule item");
  const parsed = scheduleFields.partial().safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const d = parsed.data;
  const unit = await getEquipment(db, fleetId, existing.equipmentId);
  const mileage = d.mileageInterval !== undefined ? d.mileageInterval : existing.mileageInterval;
  const days = d.timeInterval !== undefined ? d.timeInterval : existing.timeIntervalDays;
  const problem = checkTriggers(unit!.type, mileage, days);
  if (problem) return problem;
  const [schedule] = await db.update(schema.maintenanceSchedules).set({
    ...(d.name !== undefined && { name: d.name }),
    ...(d.category !== undefined && { category: d.category }),
    ...(d.description !== undefined && { description: d.description }),
    ...(d.enabled !== undefined && { enabled: d.enabled }),
    mileageInterval: mileage ?? null, timeIntervalDays: days ?? null, updatedAt: new Date(),
  }).where(and(eq(schema.maintenanceSchedules.fleetId, fleetId), eq(schema.maintenanceSchedules.id, id))).returning();
  return { ok: true, schedule };
}

export async function deleteSchedule(db: AppDb, fleetId: string, id: string): Promise<{ ok: true } | Failure> {
  if (!(await getSchedule(db, fleetId, id))) return notFound("That schedule item");
  await db.delete(schema.maintenanceSchedules)
    .where(and(eq(schema.maintenanceSchedules.fleetId, fleetId), eq(schema.maintenanceSchedules.id, id)));
  return { ok: true };
}
