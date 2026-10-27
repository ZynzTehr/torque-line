import { describe, expect, it, vi } from "vitest";
import { buildDiagnosisTurn, runDiagnosis } from "@/ai/diagnose";
import { imageBlock } from "@/ai/tasks";
import type { AiTransport } from "@/ai/structured";

const unit = { unitNumber: "101", type: "tractor" as const, year: "2020", make: "Freightliner", model: "Cascadia", engineSize: "DD15", currentMileage: 482150, currentHours: null };
const output = { causes: [{ name: "Clogged fuel filter", likelihood: "high", why: "w", how_to_check: "c", cost_tier: "low", safety_critical: false, needs_shop: false }], follow_up_questions: ["Any codes?"] };

describe("buildDiagnosisTurn", () => {
  it("opens with photos first, then unit context and the symptom; stores a placeholder instead of image bytes", () => {
    const img = imageBlock("image/jpeg", "AAAA");
    const turn = buildDiagnosisTurn({ unit, symptom: "Loses power climbing grades", images: [img, img] });
    expect(turn.send.map((b) => b.type)).toEqual(["image", "image", "text"]);
    expect((turn.send[2] as { text: string }).text).toMatch(/Unit 101.*Freightliner Cascadia/s);
    expect((turn.send[2] as { text: string }).text).toMatch(/482,150 mi/);
    expect(turn.store).toEqual([{ type: "text", text: "[2 photos were attached to this message]" }, turn.send[2]]);
  });

  it("follow-up turns report tried and ruled-out causes plus the user's new note", () => {
    const turn = buildDiagnosisTurn({ statuses: [{ name: "Fuel filter", status: "tried" }, { name: "Lift pump", status: "ruled_out" }], note: "Replaced filter, no change" });
    const text = (turn.send[0] as { text: string }).text;
    expect(text).toMatch(/Tried without fixing it: Fuel filter/);
    expect(text).toMatch(/Ruled out: Lift pump/);
    expect(text).toMatch(/Replaced filter, no change/);
  });
});

describe("runDiagnosis", () => {
  it("replays prior turns, asks at high effort, and applies the guardrails", async () => {
    const parse = vi.fn<AiTransport["parse"]>(async () => ({ stop_reason: "end_turn", parsed_output: output, model: "claude-opus-5-5" }));
    const prior = [
      { role: "user" as const, content: [{ type: "text" as const, text: "first" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "{}" }] },
    ];
    const r = await runDiagnosis({ parse }, { prior, turn: buildDiagnosisTurn({ statuses: [], note: "still bad" }), statuses: [] });
    expect(r).toMatchObject({ ok: true, data: { causes: [{ name: "Clogged fuel filter", tried: false }], stopAndInspect: false } });
    const params = parse.mock.calls[0][0] as unknown as { messages: unknown[]; output_config: { effort: string } };
    expect(params.output_config.effort).toBe("high");
    expect(params.messages).toHaveLength(3);
  });
});

describe("buildRefineTurn", () => {
  it("re-sends the opening context when the first model call never happened", async () => {
    const { buildRefineTurn } = await import("@/ai/diagnose");
    const img = imageBlock("image/jpeg", "AAAA");
    const turn = buildRefineTurn({ priorTurns: 0, unit, symptom: "Loses power", images: [img], statuses: [], note: "Code P0087" });
    expect(turn.send.map((b) => b.type)).toEqual(["image", "text", "text"]);
    expect(JSON.stringify(turn.send)).toMatch(/Unit 101/);
    expect(JSON.stringify(turn.send)).toMatch(/Loses power/);
    expect(JSON.stringify(turn.send)).toMatch(/P0087/);
  });
  it("sends a short update when a conversation exists", async () => {
    const { buildRefineTurn } = await import("@/ai/diagnose");
    const turn = buildRefineTurn({ priorTurns: 2, unit, symptom: "x", images: [], statuses: [{ name: "Lift pump", status: "tried" }] });
    expect(turn.send).toHaveLength(1);
    expect(JSON.stringify(turn.send)).toMatch(/Lift pump/);
  });
});
