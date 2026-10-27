import { and, eq } from "drizzle-orm";
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
 * Advance a unit's meter from secondary evidence (a service record or fuel receipt) inside the caller's
 * transaction. Moves only forward, and only for evidence observed no earlier than the current reading:
 * older evidence never rolls back a newer reading, including a confirmed correction.
 * Returns whether the meter moved.
 */
export async function advanceMeterFromEvidence(tx: Tx, actor: Actor, input: {
  equipmentId: string; value: number; observedAt: Date; source: "service" | "fuel";
}): Promise<boolean> {
  const [unit] = await tx.select().from(schema.equipment)
    .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, input.equipmentId))).for("update");
  if (!unit || unit.type === "trailer") return false;
  const isReefer = unit.type === "reefer";
  const current = isReefer ? unit.currentHours : unit.currentMileage;
  if (current != null && input.value < current) return false;
  if (unit.readingUpdatedAt && input.observedAt < unit.readingUpdatedAt) return false;
  await tx.insert(schema.readings).values({
    fleetId: actor.fleetId, equipmentId: unit.id, kind: isReefer ? "hours" : "odometer", value: input.value,
    observedAt: input.observedAt, source: input.source, createdBy: actor.userId,
  });
  await tx.update(schema.equipment)
    .set(isReefer
      ? { currentHours: input.value, readingUpdatedAt: input.observedAt, updatedAt: new Date() }
      : { currentMileage: input.value, readingUpdatedAt: input.observedAt, updatedAt: new Date() })
    .where(and(eq(schema.equipment.fleetId, actor.fleetId), eq(schema.equipment.id, unit.id)));
  return true;
}

/** Business dates become noon UTC so a date-only observation sorts consistently against timestamped readings. */
export const observedAtFromDate = (date: string) => new Date(`${date}T12:00:00Z`);
