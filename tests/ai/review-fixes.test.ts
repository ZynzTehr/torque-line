import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { applyDiagnosisGuardrails } from "@/ai/diagnosis";
import { askStructured } from "@/ai/structured";

const flagged = (name: string, why = "") =>
  applyDiagnosisGuardrails({ causes: [{ name, why, likelihood: "high", how_to_check: "c", cost_tier: "low", safety_critical: false, needs_shop: false }], follow_up_questions: [] }, { triedOrRuledOut: [] }).stopAndInspect;

describe("safety backstop catches plural and verb forms the model leaves unflagged", () => {
  it.each([
    "Wheel bearings failing", "Air leaks at treadle valve", "Fuel leaking from injector line", "Cracked frame rail", "Loose wheel",
    "Cracked wheel rim", "Leaking hub oil seal", "Worn brake pads", "Steer axle kingpin play", "Exhaust fumes entering the cab", "Air bag leaking",
  ])("%s", (name) => expect(flagged(name)).toBe(true));

  it.each(["Dirty MAF sensor", "Clogged fuel filter", "Weak alternator", "Faulty DEF heater", "Loose battery cable"])(
    "does not flag %s", (name) => expect(flagged(name)).toBe(false));
});

describe("askStructured failure mapping", () => {
  it("maps the SDK's local parse failure (truncated or invalid JSON) to unreadable, not unavailable", async () => {
    const t = { parse: async () => { throw new Anthropic.AnthropicError("Failed to parse structured output"); } };
    expect(await askStructured(t, { schema: z.object({ v: z.number() }), system: "s", content: [], effort: "low" })).toEqual({ ok: false, code: "unreadable" });
  });
});
