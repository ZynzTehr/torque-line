"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { buildDiagnosisTurn, runDiagnosis, type StoredTurn } from "@/ai/diagnose";
import type { CauseStatus } from "@/ai/diagnosis";
import { anthropicTransport, type AiFailure } from "@/ai/structured";
import { lookupIntervals, readMeter, readServiceReceipt } from "@/ai/tasks";
import { consumeAiRequest } from "@/server/aiQuota";
import { fileToImageBlock, MAX_IMAGES } from "@/server/aiImages";
import { appendTurn, createSession, getSession, markCause, replaceCauses, resolveSession } from "@/server/diagnosticsStore";
import { getEquipment } from "@/server/equipmentStore";
import { requireFleet } from "@/server/fleet";
import { addSchedule } from "@/server/scheduleStore";

type UiFailure = { ok: false; message: string; manual?: boolean };

const AI_MESSAGES: Record<AiFailure["code"], string> = {
  refused: "The assistant couldn't help with this one. You can enter it manually.",
  unreadable: "That didn't come through clearly. Try another photo, or enter it manually.",
  unavailable: "The assistant is unavailable right now. Try again in a minute, or enter it manually.",
  quota: "Your fleet has used today's AI requests. They reset tomorrow.",
  "not-configured": "AI features aren't configured on this server yet.",
};
const aiFailure = (code: AiFailure["code"]): UiFailure => ({ ok: false, message: AI_MESSAGES[code], manual: true });
const today = () => new Date().toISOString().slice(0, 10);

/** Count a request against the fleet's daily limit. Called after input validation, right before the model call. */
const spend = (fleetId: string) => consumeAiRequest(getDb(), fleetId, today());

export async function readMeterAction(form: FormData) {
  const ctx = await requireFleet();
  const unit = await getEquipment(getDb(), ctx.fleetId, String(form.get("equipmentId") ?? ""));
  if (!unit || unit.type === "trailer") return { ok: false as const, message: "That unit doesn't have a meter." };
  const image = await fileToImageBlock(form.get("photo"));
  if (!image.ok) return { ok: false as const, message: image.message };
  if (!(await spend(ctx.fleetId)).ok) return aiFailure("quota");
  const r = await readMeter(anthropicTransport(), image.block, unit.type === "reefer" ? "hours" : "odometer");
  return r.ok ? { ok: true as const, ...r.data } : aiFailure(r.code);
}

export async function readServiceReceiptAction(form: FormData) {
  const ctx = await requireFleet();
  const image = await fileToImageBlock(form.get("photo"));
  if (!image.ok) return { ok: false as const, message: image.message };
  if (!(await spend(ctx.fleetId)).ok) return aiFailure("quota");
  const r = await readServiceReceipt(anthropicTransport(), image.block);
  if (!r.ok) return aiFailure(r.code);
  if (!r.data.isServiceRecord) return { ok: false as const, message: "That doesn't look like a service receipt.", manual: true };
  return { ok: true as const, ...r.data };
}

export async function lookupIntervalsAction(equipmentId: string) {
  const ctx = await requireFleet();
  const unit = await getEquipment(getDb(), ctx.fleetId, equipmentId);
  if (!unit) return { ok: false as const, message: "That unit wasn't found." };
  if (!(await spend(ctx.fleetId)).ok) return aiFailure("quota");
  const r = await lookupIntervals(anthropicTransport(), unit);
  return r.ok ? { ok: true as const, ...r.data } : aiFailure(r.code);
}

/** Nothing the AI suggests is saved until the owner picks the items to keep. */
export async function acceptIntervalsAction(equipmentId: string, items: { name: string; category: "PM-A" | "PM-B" | "PM-C" | "Annual"; mileageInterval: number | null; timeInterval: number | null; description: string; sourceDetail: string }[]) {
  const { fleetId } = await requireFleet();
  const added: string[] = [];
  for (const item of items.slice(0, 40)) {
    const r = await addSchedule(getDb(), fleetId, equipmentId, { ...item, source: "ai_accepted" });
    if (r.ok) added.push(item.name);
  }
  if (added.length) refresh();
  return { ok: true as const, added: added.length, skipped: Math.min(items.length, 40) - added.length };
}

// --- Diagnostics ---------------------------------------------------------------------------

export async function startDiagnosisAction(form: FormData) {
  const ctx = await requireFleet();
  const db = getDb();
  const actor = { fleetId: ctx.fleetId, userId: ctx.user.id };
  const photos = form.getAll("photos").filter((f) => f instanceof File && f.size > 0);
  if (photos.length > MAX_IMAGES) return { ok: false as const, message: `Attach up to ${MAX_IMAGES} photos.` };
  const images = [];
  for (const p of photos) {
    const r = await fileToImageBlock(p);
    if (!r.ok) return { ok: false as const, message: r.message };
    images.push(r.block);
  }
  const created = await createSession(db, actor, { equipmentId: String(form.get("equipmentId") ?? ""), symptom: String(form.get("symptom") ?? "") });
  if (!created.ok) return { ok: false as const, message: created.message };
  if (!(await spend(ctx.fleetId)).ok) return { ...aiFailure("quota"), sessionId: created.session.id };

  const unit = (await getEquipment(db, ctx.fleetId, created.session.equipmentId))!;
  const turn = buildDiagnosisTurn({ unit, symptom: created.session.symptom, images });
  const r = await runDiagnosis(anthropicTransport(), { prior: [], turn, statuses: [] });
  if (!r.ok) return { ...aiFailure(r.code), sessionId: created.session.id };
  await appendTurn(db, ctx.fleetId, created.session.id, "user", turn.store);
  await appendTurn(db, ctx.fleetId, created.session.id, "assistant", [{ type: "text", text: JSON.stringify(r.raw) }]);
  await replaceCauses(db, ctx.fleetId, created.session.id, r.data.causes);
  return { ok: true as const, sessionId: created.session.id, followUpQuestions: r.data.followUpQuestions };
}

export async function refineDiagnosisAction(sessionId: string, note: string) {
  const ctx = await requireFleet();
  const db = getDb();
  const view = await getSession(db, ctx.fleetId, sessionId);
  if (!view) return { ok: false as const, message: "That diagnosis wasn't found." };
  if (!(await spend(ctx.fleetId)).ok) return aiFailure("quota");
  const statuses: CauseStatus[] = view.causes.filter((c) => c.tried || c.ruledOut)
    .map((c) => ({ name: c.name, status: c.ruledOut ? "ruled_out" : "tried" }));
  const prior = view.turns.map((t) => ({ role: t.role, content: t.content }) as StoredTurn);
  const turn = buildDiagnosisTurn({ statuses, note });
  const r = await runDiagnosis(anthropicTransport(), { prior, turn, statuses });
  if (!r.ok) return aiFailure(r.code);
  await appendTurn(db, ctx.fleetId, sessionId, "user", turn.store);
  await appendTurn(db, ctx.fleetId, sessionId, "assistant", [{ type: "text", text: JSON.stringify(r.raw) }]);
  await replaceCauses(db, ctx.fleetId, sessionId, r.data.causes);
  refresh();
  return { ok: true as const, followUpQuestions: r.data.followUpQuestions };
}

export async function markCauseAction(causeId: string, status: "tried" | "ruled_out" | "open") {
  const { fleetId } = await requireFleet();
  const r = await markCause(getDb(), fleetId, causeId, status);
  if (r.ok) refresh();
  return r;
}

export async function resolveDiagnosisAction(sessionId: string, note: string) {
  const { fleetId } = await requireFleet();
  const r = await resolveSession(getDb(), fleetId, sessionId, note);
  if (r.ok) refresh();
  return r;
}
