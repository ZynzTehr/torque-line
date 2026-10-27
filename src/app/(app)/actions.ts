"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { requireFleet } from "@/server/fleet";
import { guarded } from "@/server/guarded";
import { archiveEquipment, createEquipment, updateEquipment, type EquipmentInput } from "@/server/equipmentStore";
import { recordReading, type ReadingInput } from "@/server/readingsStore";
import { addSchedule, applyDefaultSchedule, deleteSchedule, updateSchedule, type ScheduleInput } from "@/server/scheduleStore";
import { deleteServiceRecord, logService, updateServiceRecord, type ServiceEditInput, type ServiceInput } from "@/server/serviceStore";
import { deleteAttachments, listAttachments, saveAttachment } from "@/server/attachmentsStore";
import { neonObjectStore } from "@/server/objectStore";
import { addFuelStop, deleteFuelStop, type FuelStopInput } from "@/server/fuelStore";

/**
 * Server actions are public HTTP endpoints. Each one derives the fleet from the session through
 * requireFleet() and passes plain data to a tested store; nothing here trusts a client-sent fleet id.
 */
async function withFleet<T>(run: (ctx: { fleetId: string; userId: string }) => Promise<T>) {
  return guarded(run.name || "action", async () => {
    const { fleetId, user } = await requireFleet();
    const result = await run({ fleetId, userId: user.id });
    if ((result as { ok?: boolean })?.ok) refresh();
    return result;
  });
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
    return r.ok ? { ok: true as const, id: r.record.id } : r;
  });
}

export async function updateServiceRecordAction(id: string, input: ServiceEditInput) {
  return withFleet(async (actor) => {
    const r = await updateServiceRecord(getDb(), actor, id, input);
    return r.ok ? { ok: true as const, id: r.record.id } : r;
  });
}

export async function deleteServiceRecordAction(id: string) {
  return withFleet(async ({ fleetId }) => {
    const r = await deleteServiceRecord(getDb(), fleetId, id);
    if (r.ok) await deleteAttachments(getDb(), await neonObjectStore(), fleetId, { kind: "service_receipt", parentId: id });
    return r;
  });
}

const RECEIPT_KINDS = ["service_receipt", "fuel_receipt"] as const;

/** Save a receipt photo on a service record or fuel stop, replacing the one it had. */
export async function attachReceiptAction(form: FormData) {
  return withFleet(async (actor) => {
    const kind = RECEIPT_KINDS.find((k) => k === form.get("kind"));
    const parentId = String(form.get("parentId") ?? "");
    const photo = form.get("photo");
    if (!kind || !(photo instanceof File)) return { ok: false as const, code: "invalid" as const, message: "Choose a receipt photo." };
    const db = getDb();
    const store = await neonObjectStore();
    const saved = await saveAttachment(db, store, actor, { kind, parentId, bytes: new Uint8Array(await photo.arrayBuffer()), contentType: photo.type });
    if (!saved.ok) return saved;
    for (const old of await listAttachments(db, actor.fleetId, kind, parentId)) {
      if (old.id !== saved.attachment.id) await deleteAttachments(db, store, actor.fleetId, { id: old.id });
    }
    return { ok: true as const };
  });
}

export async function removeAttachmentAction(id: string) {
  return withFleet(async ({ fleetId }) => {
    const removed = await deleteAttachments(getDb(), await neonObjectStore(), fleetId, { id });
    return removed ? { ok: true as const } : { ok: false as const, code: "not-found" as const, message: "That receipt wasn't found." };
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

export async function addFuelStopAction(input: FuelStopInput) {
  return withFleet((actor) => addFuelStop(getDb(), actor, input));
}

export async function deleteFuelStopAction(id: string) {
  return withFleet(({ fleetId }) => deleteFuelStop(getDb(), fleetId, id));
}
