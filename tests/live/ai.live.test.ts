// Real Claude calls through the app's AI layer. Costs a few cents per run.
// Run: set -a; . ./.env.local; set +a; LIVE=1 npx vitest run tests/live/ai.live.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_MODEL, anthropicTransport, READ_MODEL, type AiModel, type AiTransport } from "@/ai/structured";
import { imageBlock, lookupIntervals, readFuelReceipt, readMeter, readServiceReceipt } from "@/ai/tasks";
import { buildDiagnosisTurn, runDiagnosis, type StoredTurn } from "@/ai/diagnose";

const live = Boolean(process.env.LIVE && process.env.ANTHROPIC_API_KEY);
const t = live ? anthropicTransport() : null;
const MINUTES = 4 * 60_000;

const photo = (name: string) => imageBlock("image/png", readFileSync(new URL(`../fixtures/${name}.png`, import.meta.url)).toString("base64"));
/** Sends every request, the Opus retry included, to one model, so each model's read is measured on its own. */
const pinned = (model: AiModel): AiTransport | null => t && { parse: (params) => t.parse({ ...params, model }) };

// Rendered photos with distractors: a trip meter, unit hours next to engine hours, mileage in and out, merchandise and a combined total.
const photoReads = [
  ["odometer", (x: AiTransport | null) => readMeter(x, photo("odometer"), "odometer"), { value: 482317 }],
  ["reefer hour meter", (x: AiTransport | null) => readMeter(x, photo("hourmeter"), "hours"), { value: 12486 }],
  ["service invoice", (x: AiTransport | null) => readServiceReceipt(x, photo("service-invoice")),
    { isServiceRecord: true, date: "2026-10-14", mileage: 612480, cost: 486.37, unitNumber: "T-12" }],
  ["fuel receipt", (x: AiTransport | null) => readFuelReceipt(x, photo("fuel-receipt")),
    { is_fuel_receipt: true, date: "2026-10-20", odometer: 612955, items: [
      { fuel_type: "diesel", gallons: 120.5, price_per_gallon: 3.899, total_cost: 469.83 },
      { fuel_type: "def", gallons: 5, price_per_gallon: 3.5, total_cost: 17.5 },
    ] }],
] as const;

describe.skipIf(!live)("Claude, live", () => {
  describe.each<AiModel>([READ_MODEL, AI_MODEL])("photo reads on %s", (model) => {
    it.each(photoReads)("reads the %s", async (_, read, expected) => {
      const r = await read(pinned(model));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.model).toContain(model);
      expect(r.data).toMatchObject(expected);
    }, MINUTES);
  });

  it("answers photo reads from Haiku without the Opus retry", async () => {
    const r = await readMeter(t, photo("odometer"), "odometer");
    expect(r).toMatchObject({ ok: true, model: expect.stringContaining(READ_MODEL), data: { value: 482317 } });
  }, MINUTES);

  it("suggests intervals for a known tractor, in PM-A < PM-B < PM-C order", async () => {
    const r = await lookupIntervals(t, { type: "tractor", year: "2020", make: "Freightliner", model: "Cascadia", engineSize: "DD15" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.items.length).toBeGreaterThan(2);
      expect(r.data.globalWarnings.some((w) => /should be SHORTER/.test(w))).toBe(false);
    }
  }, MINUTES);

  it("flags a brake symptom as stop-and-inspect, then re-ranks after a cause is ruled out", async () => {
    const turn = buildDiagnosisTurn({
      unit: { unitNumber: "T-12", type: "tractor", year: "2019", make: "Peterbilt", model: "579", currentMileage: 610000 },
      symptom: "Truck pulls hard to the left when braking, and I hear a hiss from the front axle area after parking.",
      images: [],
    });
    const first = await runDiagnosis(t, { prior: [], turn, statuses: [] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.stopAndInspect).toBe(true);
    expect(first.data.causes.length).toBeGreaterThan(1);

    const ruledOut = first.data.causes[0].name;
    const prior: StoredTurn[] = [
      { role: "user", content: turn.store },
      { role: "assistant", content: [{ type: "text", text: JSON.stringify(first.raw) }] },
    ];
    const statuses = [{ name: ruledOut, status: "ruled_out" as const }];
    const second = await runDiagnosis(t, { prior, turn: buildDiagnosisTurn({ statuses }), statuses });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.causes.length).toBeGreaterThan(0);
    // The model itself must drop it, not just the guardrail filter.
    const rawNames = (second.raw as { causes: { name: string }[] }).causes.map((c) => c.name.toLowerCase());
    expect(rawNames).not.toContain(ruledOut.toLowerCase());
  }, 2 * MINUTES);
});
