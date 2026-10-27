// Real Claude calls through the app's AI layer. Costs a few cents per run.
// Run: set -a; . ./.env.local; set +a; LIVE=1 npx vitest run tests/live/ai.live.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { anthropicTransport } from "@/ai/structured";
import { imageBlock, lookupIntervals, readMeter } from "@/ai/tasks";
import { buildDiagnosisTurn, runDiagnosis, type StoredTurn } from "@/ai/diagnose";

const live = Boolean(process.env.LIVE && process.env.ANTHROPIC_API_KEY);
const t = live ? anthropicTransport() : null;
const MINUTES = 4 * 60_000;

describe.skipIf(!live)("Claude, live", () => {
  it("reads the odometer total and ignores the trip meter", async () => {
    const png = readFileSync(new URL("../fixtures/odometer.png", import.meta.url)).toString("base64");
    const r = await readMeter(t, imageBlock("image/png", png), "odometer");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.value).toBe(482317);
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
