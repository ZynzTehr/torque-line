import { and, eq, gte, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { AppDb, FleetStatus } from "./fleetStore";
import { forbidden, invalid, notFound, type Failure } from "./result";

/** Platform operators are listed in platform_admins; nothing in the app can add one. */
export async function isPlatformAdmin(db: AppDb, userId: string): Promise<boolean> {
  const [row] = await db.select({ userId: schema.platformAdmins.userId }).from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.userId, userId)).limit(1);
  return Boolean(row);
}

export interface AdminFleetRow {
  fleetId: string;
  fleetName: string;
  ownerUserId: string;
  ownerEmail: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  seenLast7d: boolean;
  status: FleetStatus;
  statusNote: string | null;
  statusChangedAt: Date | null;
  unitCount: number;
  aiRequests30d: number;
}

/** Every fleet, newest first, with the numbers an operator needs to judge an account. Callers must check isPlatformAdmin. */
export async function listFleetsForAdmin(db: AppDb): Promise<AdminFleetRow[]> {
  const units = db.select({ fleetId: schema.equipment.fleetId, n: sql<number>`count(*)::int`.as("unit_count") })
    .from(schema.equipment).where(sql`${schema.equipment.archivedAt} is null`).groupBy(schema.equipment.fleetId).as("units");
  const ai = db.select({ fleetId: schema.aiUsage.fleetId, n: sql<number>`sum(${schema.aiUsage.requests})::int`.as("ai_count") })
    .from(schema.aiUsage).where(gte(schema.aiUsage.day, sql`current_date - 30`)).groupBy(schema.aiUsage.fleetId).as("ai");
  const f = schema.fleets;
  return db.select({
    fleetId: f.id, fleetName: f.name, ownerUserId: f.ownerUserId, ownerEmail: f.ownerEmail, createdAt: f.createdAt,
    lastSeenAt: f.lastSeenAt, seenLast7d: sql<boolean>`coalesce(${f.lastSeenAt} > now() - interval '7 days', false)`, status: f.status, statusNote: f.statusNote, statusChangedAt: f.statusChangedAt,
    unitCount: sql<number>`coalesce(${units.n}, 0)`, aiRequests30d: sql<number>`coalesce(${ai.n}, 0)`,
  }).from(f)
    .leftJoin(units, eq(units.fleetId, f.id))
    .leftJoin(ai, eq(ai.fleetId, f.id))
    .orderBy(sql`${f.createdAt} desc`);
}

export async function setFleetStatus(
  db: AppDb, actorUserId: string, input: { fleetId: string; status: FleetStatus; note?: string | null },
): Promise<{ ok: true } | Failure> {
  if (!(await isPlatformAdmin(db, actorUserId))) return forbidden();
  if (input.status !== "active" && input.status !== "inactive") return invalid("Choose active or inactive.");
  const [fleet] = await db.select({ owner: schema.fleets.ownerUserId }).from(schema.fleets)
    .where(sql`${schema.fleets.id}::text = ${input.fleetId}`).limit(1);
  if (!fleet) return notFound("That fleet");
  if (fleet.owner === actorUserId && input.status === "inactive") return invalid("You can't deactivate your own fleet.");
  await db.update(schema.fleets).set({
    status: input.status,
    statusNote: input.note?.trim().slice(0, 500) || null,
    statusChangedAt: sql`now()`,
    statusChangedBy: actorUserId,
  }).where(and(eq(schema.fleets.id, input.fleetId)));
  return { ok: true };
}
