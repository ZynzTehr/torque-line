import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { formatMileage } from "@/domain/format";
import { sanitizePromptInput } from "@/domain/aiGuardrails";
import type { EquipmentType } from "@/domain/types";
import { applyDiagnosisGuardrails, DIAGNOSIS_SYSTEM, diagnosisSchema, type CauseStatus, type GuardedDiagnosis } from "./diagnosis";
import { askStructured, type AiResult, type AiTransport } from "./structured";

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
type ImageBlock = Anthropic.Beta.Messages.BetaImageBlockParam;
export interface StoredTurn { role: "user" | "assistant"; content: Block[] }

export interface UnitContext {
  unitNumber: string; type: EquipmentType; year?: string | null; make?: string | null; model?: string | null;
  engineSize?: string | null; currentMileage?: number | null; currentHours?: number | null;
}

/**
 * One user turn. `send` goes to the model now; `store` is what the history keeps, with photos
 * replaced by a note so stored conversations stay small and replays stay text-only.
 */
export function buildDiagnosisTurn(input:
  | { unit: UnitContext; symptom: string; images: ImageBlock[] }
  | { statuses: CauseStatus[]; note?: string }): { send: Block[]; store: Block[] } {
  if ("unit" in input) {
    const u = input.unit;
    const kind = u.type === "reefer" ? "reefer unit" : u.type === "trailer" ? "trailer" : "tractor";
    const meter = u.type === "reefer" ? (u.currentHours != null ? `${formatMileage(u.currentHours)} engine hours` : null)
      : u.type === "tractor" ? (u.currentMileage != null ? `${formatMileage(u.currentMileage)} mi` : null) : null;
    const details = [u.year, u.make, u.model, u.engineSize && `(${u.engineSize})`].map((v) => sanitizePromptInput(v)).filter(Boolean).join(" ");
    const context = `Unit ${sanitizePromptInput(u.unitNumber)}: ${kind}${details ? `, ${details}` : ""}${meter ? `, ${meter}` : ""}.`;
    const textBlock: Block = { type: "text", text: `${context}\n\nReported symptom:\n${input.symptom.slice(0, 4000)}` };
    const photoNote: Block[] = input.images.length
      ? [{ type: "text", text: `[${input.images.length} photo${input.images.length === 1 ? " was" : "s were"} attached to this message]` }] : [];
    return { send: [...input.images, textBlock], store: [...photoNote, textBlock] };
  }
  const tried = input.statuses.filter((s) => s.status === "tried").map((s) => s.name);
  const ruled = input.statuses.filter((s) => s.status === "ruled_out").map((s) => s.name);
  const lines = [
    "Update from the owner.",
    tried.length ? `Tried without fixing it: ${tried.join("; ")}.` : null,
    ruled.length ? `Ruled out: ${ruled.join("; ")}.` : null,
    input.note?.trim() ? `New information: ${input.note.trim().slice(0, 2000)}` : null,
    "Re-rank the remaining probable causes.",
  ].filter(Boolean);
  const block: Block = { type: "text", text: lines.join("\n") };
  return { send: [block], store: [block] };
}

export async function runDiagnosis(t: AiTransport | null, opts: { prior: StoredTurn[]; turn: { send: Block[] }; statuses: CauseStatus[] }):
  Promise<AiResult<GuardedDiagnosis> & { raw?: unknown }> {
  const r = await askStructured(t, {
    schema: diagnosisSchema, effort: "high", maxTokens: 12000, system: DIAGNOSIS_SYSTEM,
    messages: [...opts.prior, { role: "user", content: opts.turn.send }],
  });
  if (!r.ok) return r;
  return { ok: true, model: r.model, data: applyDiagnosisGuardrails(r.data, { triedOrRuledOut: opts.statuses }), raw: r.data };
}

/**
 * The user turn for a refinement. If the session has no conversation yet (its first model call failed),
 * send the full opening context instead of a bare update, so the model sees the unit, symptom, and photos.
 */
export function buildRefineTurn(opts: {
  priorTurns: number; unit: UnitContext; symptom: string; images: ImageBlock[]; statuses: CauseStatus[]; note?: string;
}): { send: Block[]; store: Block[] } {
  if (opts.priorTurns > 0) return buildDiagnosisTurn({ statuses: opts.statuses, note: opts.note });
  const opening = buildDiagnosisTurn({ unit: opts.unit, symptom: opts.symptom, images: opts.images });
  const note = opts.note?.trim();
  if (!note) return opening;
  const extra: Block = { type: "text", text: `Additional information from the owner: ${note.slice(0, 2000)}` };
  return { send: [...opening.send, extra], store: [...opening.store, extra] };
}
