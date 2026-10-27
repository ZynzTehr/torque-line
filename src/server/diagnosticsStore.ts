import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import type { AppDb } from "./fleetStore";
import { getEquipment } from "./equipmentStore";
import { invalid, notFound, type Actor, type Failure } from "./result";

export type SessionRow = typeof schema.diagnosticSessions.$inferSelect;
export type CauseRow = typeof schema.diagnosticCauses.$inferSelect;
export type TurnRow = typeof schema.diagnosticTurns.$inferSelect;

export interface CauseInput {
  name: string; likelihood: "high" | "medium" | "low"; why: string; how_to_check: string;
  cost_tier: "free" | "low" | "medium" | "high"; safety_critical: boolean; needs_shop: boolean; tried: boolean;
}

const isUuid = (id: string) => z.uuid().safeParse(id).success;

export async function createSession(db: AppDb, actor: Actor, input: { equipmentId: string; symptom: string }):
  Promise<{ ok: true; session: SessionRow } | Failure> {
  const symptom = input.symptom.trim();
  if (!symptom) return invalid("Describe what the unit is doing.");
  if (symptom.length > 4000) return invalid("Keep the description under 4,000 characters.");
  const unit = await getEquipment(db, actor.fleetId, input.equipmentId);
  if (!unit) return notFound("That unit");
  const [session] = await db.insert(schema.diagnosticSessions)
    .values({ fleetId: actor.fleetId, equipmentId: unit.id, symptom, createdBy: actor.userId }).returning();
  return { ok: true, session };
}

async function ownedSession(db: AppDb, fleetId: string, id: string): Promise<SessionRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(schema.diagnosticSessions)
    .where(and(eq(schema.diagnosticSessions.fleetId, fleetId), eq(schema.diagnosticSessions.id, id)));
  return row ?? null;
}

export async function getSession(db: AppDb, fleetId: string, id: string) {
  const session = await ownedSession(db, fleetId, id);
  if (!session) return null;
  const [turns, causes] = await Promise.all([
    db.select().from(schema.diagnosticTurns)
      .where(and(eq(schema.diagnosticTurns.fleetId, fleetId), eq(schema.diagnosticTurns.sessionId, id)))
      .orderBy(asc(schema.diagnosticTurns.seq)),
    db.select().from(schema.diagnosticCauses)
      .where(and(eq(schema.diagnosticCauses.fleetId, fleetId), eq(schema.diagnosticCauses.sessionId, id)))
      .orderBy(asc(schema.diagnosticCauses.ruledOut), asc(schema.diagnosticCauses.rank)),
  ]);
  return { session, turns, causes };
}

export async function listSessions(db: AppDb, fleetId: string, limit = 20) {
  return db.select({
    id: schema.diagnosticSessions.id, symptom: schema.diagnosticSessions.symptom, status: schema.diagnosticSessions.status,
    createdAt: schema.diagnosticSessions.createdAt, unitNumber: schema.equipment.unitNumber, equipmentId: schema.equipment.id,
  }).from(schema.diagnosticSessions)
    .innerJoin(schema.equipment, eq(schema.equipment.id, schema.diagnosticSessions.equipmentId))
    .where(eq(schema.diagnosticSessions.fleetId, fleetId))
    .orderBy(desc(schema.diagnosticSessions.createdAt)).limit(limit);
}

/** Append one turn of the model conversation. Turns are never edited, so replays stay cache-friendly. */
export async function appendTurn(db: AppDb, fleetId: string, sessionId: string, role: "user" | "assistant", content: unknown) {
  if (!(await ownedSession(db, fleetId, sessionId))) return notFound("That diagnosis");
  await db.insert(schema.diagnosticTurns).values({
    fleetId, sessionId, role, content,
    seq: sql`(select coalesce(max(seq), 0) + 1 from diagnostic_turns where session_id = ${sessionId})`,
  });
  return { ok: true as const };
}

/** Replace the open ranked list. Ruled-out causes are kept (shown struck through) and are not re-ranked. */
export async function replaceCauses(db: AppDb, fleetId: string, sessionId: string, causes: CauseInput[]) {
  if (!(await ownedSession(db, fleetId, sessionId))) return notFound("That diagnosis");
  await db.transaction(async (tx) => {
    await tx.delete(schema.diagnosticCauses).where(and(
      eq(schema.diagnosticCauses.fleetId, fleetId), eq(schema.diagnosticCauses.sessionId, sessionId), eq(schema.diagnosticCauses.ruledOut, false)));
    if (causes.length) {
      await tx.insert(schema.diagnosticCauses).values(causes.map((c, i) => ({
        fleetId, sessionId, rank: i + 1, name: c.name.slice(0, 200), likelihood: c.likelihood, why: c.why.slice(0, 2000),
        howToCheck: c.how_to_check.slice(0, 2000), costTier: c.cost_tier, safetyCritical: c.safety_critical,
        needsShop: c.needs_shop, tried: c.tried,
      })));
    }
    await tx.update(schema.diagnosticSessions).set({ updatedAt: new Date() })
      .where(and(eq(schema.diagnosticSessions.fleetId, fleetId), eq(schema.diagnosticSessions.id, sessionId)));
  });
  return { ok: true as const };
}

export async function markCause(db: AppDb, fleetId: string, causeId: string, status: "tried" | "ruled_out" | "open") {
  if (!isUuid(causeId)) return notFound("That cause");
  const updated = await db.update(schema.diagnosticCauses)
    .set({ tried: status === "tried", ruledOut: status === "ruled_out", updatedAt: new Date() })
    .where(and(eq(schema.diagnosticCauses.fleetId, fleetId), eq(schema.diagnosticCauses.id, causeId)))
    .returning({ id: schema.diagnosticCauses.id });
  return updated.length ? { ok: true as const } : notFound("That cause");
}

export async function resolveSession(db: AppDb, fleetId: string, id: string, note: string) {
  if (!(await ownedSession(db, fleetId, id))) return notFound("That diagnosis");
  await db.update(schema.diagnosticSessions)
    .set({ status: "resolved", resolutionNote: note.trim().slice(0, 2000) || null, updatedAt: new Date() })
    .where(and(eq(schema.diagnosticSessions.fleetId, fleetId), eq(schema.diagnosticSessions.id, id)));
  return { ok: true as const };
}
