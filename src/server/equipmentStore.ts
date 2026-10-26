import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { normalizeUnitNumber } from "@/domain/units";
import type { AppDb } from "./fleetStore";
import { invalid, notFound, type Failure } from "./result";

export type EquipmentRow = typeof schema.equipment.$inferSelect;

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const equipmentInput = z.object({
  unitNumber: z.string().trim().min(1, "Enter a unit number.").max(32, "Unit numbers are at most 32 characters."),
  type: z.enum(["tractor", "trailer", "reefer"], { message: "Choose tractor, trailer, or reefer." }),
  year: optionalText(4),
  make: optionalText(60),
  model: optionalText(60),
  engineSize: optionalText(60),
  vin: optionalText(17),
  notes: optionalText(2000),
});
export type EquipmentInput = z.input<typeof equipmentInput>;

const isUniqueViolation = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const duplicate = (unit: string): Failure => ({
  ok: false, code: "duplicate-unit", message: `Unit ${unit} already exists in this fleet.`,
});

export async function listEquipment(db: AppDb, fleetId: string): Promise<EquipmentRow[]> {
  return db.select().from(schema.equipment)
    .where(and(eq(schema.equipment.fleetId, fleetId), isNull(schema.equipment.archivedAt)))
    .orderBy(asc(schema.equipment.normalizedUnitNumber));
}

/** Null when the id is unknown or belongs to another fleet; the two are indistinguishable by design. */
export async function getEquipment(db: AppDb, fleetId: string, id: string): Promise<EquipmentRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(schema.equipment)
    .where(and(eq(schema.equipment.fleetId, fleetId), eq(schema.equipment.id, id)));
  return row ?? null;
}

export async function createEquipment(db: AppDb, fleetId: string, input: EquipmentInput):
  Promise<{ ok: true; equipment: EquipmentRow } | Failure> {
  const parsed = equipmentInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const data = parsed.data;
  try {
    const [equipment] = await db.insert(schema.equipment)
      .values({ ...data, fleetId, normalizedUnitNumber: normalizeUnitNumber(data.unitNumber) })
      .returning();
    return { ok: true, equipment };
  } catch (error) {
    if (isUniqueViolation(error)) return duplicate(data.unitNumber);
    throw error;
  }
}

export async function updateEquipment(db: AppDb, fleetId: string, id: string, input: Partial<EquipmentInput>):
  Promise<{ ok: true; equipment: EquipmentRow } | Failure> {
  const existing = await getEquipment(db, fleetId, id);
  if (!existing) return notFound("That unit");
  const parsed = equipmentInput.partial().safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (data.type && data.type !== existing.type) return invalid("Equipment type can't change once a unit has history.");
  try {
    const [equipment] = await db.update(schema.equipment)
      .set({
        ...data,
        ...(data.unitNumber ? { normalizedUnitNumber: normalizeUnitNumber(data.unitNumber as string) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.equipment.fleetId, fleetId), eq(schema.equipment.id, id)))
      .returning();
    return { ok: true, equipment };
  } catch (error) {
    if (isUniqueViolation(error)) return duplicate(String(data.unitNumber));
    throw error;
  }
}

/** Archive instead of delete so service, fuel, and reading history keep their unit. */
export async function archiveEquipment(db: AppDb, fleetId: string, id: string): Promise<{ ok: true } | Failure> {
  const existing = await getEquipment(db, fleetId, id);
  if (!existing) return notFound("That unit");
  await db.update(schema.equipment).set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.equipment.fleetId, fleetId), eq(schema.equipment.id, id)));
  return { ok: true };
}
