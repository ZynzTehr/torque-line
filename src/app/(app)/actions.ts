"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { requireFleet } from "@/server/fleet";
import { archiveEquipment, createEquipment, updateEquipment, type EquipmentInput } from "@/server/equipmentStore";
import { recordReading, type ReadingInput } from "@/server/readingsStore";
import { addSchedule, applyDefaultSchedule, deleteSchedule, updateSchedule, type ScheduleInput } from "@/server/scheduleStore";
import { logService, type ServiceInput } from "@/server/serviceStore";

/**
 * Server actions are public HTTP endpoints. Each one derives the fleet from the session through
 * requireFleet() and passes plain data to a tested store; nothing here trusts a client-sent fleet id.
 */
async function withFleet<T>(run: (ctx: { fleetId: string; userId: string }) => Promise<T>): Promise<T> {
  const { fleetId, user } = await requireFleet();
  const result = await run({ fleetId, userId: user.id });
  if ((result as { ok?: boolean })?.ok) refresh();
  return result;
}

export async function createEquipmentAction(input: EquipmentInput) {
  return withFleet(async ({ fleetId }) => {
    const created = await createEquipment(getDb(), fleetId, input);
    if (created.ok) await applyDefaultSchedule(getDb(), fleetId, created.equipment.id);
    return created.ok ? { ok: true as const, id: created.equipment.id } : created;
  });
}

export async function updateEquipmentAction(id: string, input: Partial<EquipmentInput>) {
  return withFleet(async ({ fleetId }) => {
    const r = await updateEquipment(getDb(), fleetId, id, input);
    return r.ok ? { ok: true as const } : r;
  });
}

export async function archiveEquipmentAction(id: string) {
  return withFleet(({ fleetId }) => archiveEquipment(getDb(), fleetId, id));
}

export async function recordReadingAction(input: Omit<ReadingInput, "source" | "observedAt"> & { fromPhoto?: boolean }) {
  const { fromPhoto, ...rest } = input;
  return withFleet((actor) => recordReading(getDb(), actor, { ...rest, source: fromPhoto ? "photo" : "manual" }));
}

export async function logServiceAction(input: ServiceInput) {
  return withFleet(async (actor) => {
    const r = await logService(getDb(), actor, input);
    return r.ok ? { ok: true as const } : r;
  });
}

export async function applyDefaultScheduleAction(equipmentId: string) {
  return withFleet(({ fleetId }) => applyDefaultSchedule(getDb(), fleetId, equipmentId));
}

export async function addScheduleAction(equipmentId: string, input: ScheduleInput) {
  return withFleet(async ({ fleetId }) => {
    const r = await addSchedule(getDb(), fleetId, equipmentId, input);
    return r.ok ? { ok: true as const } : r;
  });
}

export async function updateScheduleAction(id: string, input: Partial<ScheduleInput>) {
  return withFleet(async ({ fleetId }) => {
    const r = await updateSchedule(getDb(), fleetId, id, input);
    return r.ok ? { ok: true as const } : r;
  });
}

export async function deleteScheduleAction(id: string) {
  return withFleet(({ fleetId }) => deleteSchedule(getDb(), fleetId, id));
}
