import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { checkReading } from "@/domain/readings";
import type { AppDb } from "./fleetStore";
import { invalid, notFound, type Actor, type Failure } from "./result";

const readingInput = z.object({
  equipmentId: z.string(),
  value: z.number().int("Readings are whole numbers."),
  confirmLower: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
  source: z.enum(["manual", "photo", "service", "fuel"]).optional(),
  observedAt: z.date().optional(),
});
export type ReadingInput = z.input<typeof readingInput>;

export type ReadingResult =
  | { ok: true; current: number }
  | { ok: false; code: "needs-confirmation"; current: number; next: number }
  | Failure;

/**
 * Append a meter reading and move the unit's current value to it, atomically.
 * A lower value is never saved silently: the caller must confirm it and give a reason.
 * The unit row is locked for the check, so two devices can't race a regression past it.
 */
export async function recordReading(db: AppDb, actor: Actor, input: ReadingInput): Promise<ReadingResult> {
  const parsed = readingInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const { equipmentId, value, confirmLower, note, source = "manual", observedAt = new Date() } = parsed.data;
  if (!z.uuid().safeParse(equipmentId).success) return notFound("That unit");

  return db.transaction(async (tx) => {
    const [unit] = await tx.select().from(schema.equipment)
      .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, equipmentId)))
      .for("update");
    if (!unit) return notFound("That unit");
    if (unit.type === "trailer") return invalid("Trailers are tracked by service date, not a meter.");

    const meter = unit.type === "reefer" ? "hours" : "odometer";
    const current = meter === "hours" ? unit.currentHours : unit.currentMileage;
    const check = checkReading(current, value, meter);
    if (check.kind === "invalid") return invalid(check.message);
    if (check.kind === "lower-than-current") {
      if (!confirmLower) return { ok: false, code: "needs-confirmation", current: check.current, next: check.next };
      if (!note) return invalid("Say why this reading is lower, for example an odometer replacement or a typo fix.");
    }

    await tx.insert(schema.readings).values({
      fleetId: actor.fleetId, equipmentId, kind: meter, value, observedAt, source,
      confirmedLower: check.kind === "lower-than-current", note: note || null, createdBy: actor.userId,
    });
    await tx.update(schema.equipment)
      .set(meter === "hours"
        ? { currentHours: value, readingUpdatedAt: observedAt, updatedAt: new Date() }
        : { currentMileage: value, readingUpdatedAt: observedAt, updatedAt: new Date() })
      .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, equipmentId)));
    return { ok: true, current: value };
  });
}

type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/**
 * Lock the given units in a fixed (sorted) order before a transaction writes child rows. Child inserts take
 * FOR KEY SHARE on the unit through their foreign keys; locking first avoids two saves on one unit deadlocking.
 */
export async function lockUnits(tx: Tx, fleetId: string, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.select({ id: schema.equipment.id }).from(schema.equipment)
      .where(and(eq(schema.equipment.fleetId, fleetId), eq(schema.equipment.id, id))).for("update");
  }
}

const dayIn = (d: Date, timeZone: string) => d.toLocaleDateString("en-CA", { timeZone });

/**
 * Advance a unit's meter from secondary evidence (a service record or fuel receipt) dated `date`,
 * inside the caller's transaction. Rules, compared by calendar day in the fleet's time zone:
 * - only forward, and only within the supported meter range;
 * - never from evidence dated before the current reading's day;
 * - never on the same day as a confirmed lower correction (stale evidence must not undo it).
 * Returns whether the meter moved.
 */
export async function advanceMeterFromEvidence(tx: Tx, actor: Actor, input: {
  equipmentId: string; value: number; date: string; source: "service" | "fuel";
}): Promise<boolean> {
  const [row] = await tx.select({ unit: schema.equipment, timeZone: schema.fleets.timezone })
    .from(schema.equipment).innerJoin(schema.fleets, eq(schema.fleets.id, schema.equipment.fleetId))
    .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, input.equipmentId))).for("update", { of: schema.equipment });
  if (!row || row.unit.type === "trailer") return false;
  const { unit, timeZone } = row;
  const isReefer = unit.type === "reefer";
  if (checkReading(null, input.value, isReefer ? "hours" : "odometer").kind !== "ok") return false;
  const current = isReefer ? unit.currentHours : unit.currentMileage;
  if (current != null && input.value < current) return false;
  if (unit.readingUpdatedAt) {
    const lastDay = dayIn(unit.readingUpdatedAt, timeZone);
    if (input.date < lastDay) return false;
    if (input.date === lastDay) {
      const [latest] = await tx.select({ confirmedLower: schema.readings.confirmedLower }).from(schema.readings)
        .where(and(eq(schema.readings.fleetId, actor.fleetId), eq(schema.readings.equipmentId, unit.id)))
        .orderBy(desc(schema.readings.observedAt), desc(schema.readings.createdAt)).limit(1);
      if (latest?.confirmedLower) return false;
    }
  }
  const observedAt = observedAtFromDate(input.date);
  const readingUpdatedAt = unit.readingUpdatedAt && unit.readingUpdatedAt > observedAt ? unit.readingUpdatedAt : observedAt;
  await tx.insert(schema.readings).values({
    fleetId: actor.fleetId, equipmentId: unit.id, kind: isReefer ? "hours" : "odometer", value: input.value,
    observedAt, source: input.source, createdBy: actor.userId,
  });
  await tx.update(schema.equipment)
    .set(isReefer
      ? { currentHours: input.value, readingUpdatedAt, updatedAt: new Date() }
      : { currentMileage: input.value, readingUpdatedAt, updatedAt: new Date() })
    .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, unit.id)));
  return true;
}

/** Business dates become noon UTC so a date-only observation has a stable instant. */
export const observedAtFromDate = (date: string) => new Date(`${date}T12:00:00Z`);

/** Service and fuel dates may be at most one day ahead (time zones), never further: a typo'd year would freeze the meter. */
export const notTooFarAhead = (date: string) => date <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
