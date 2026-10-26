import { describe, expect, it } from "vitest";
import { applyDiagnosisGuardrails, type DiagnosisOutput } from "@/ai/diagnosis";

const cause = (over: Partial<DiagnosisOutput["causes"][number]> = {}): DiagnosisOutput["causes"][number] => ({
  name: "Clogged fuel filter", likelihood: "high", why: "Power loss under load", how_to_check: "Check restriction gauge",
  cost_tier: "low", safety_critical: false, needs_shop: false, ...over,
});

describe("applyDiagnosisGuardrails", () => {
  it("forces safety-critical handling for brake, steering, air, tire, fuel-leak and exhaust-in-cab causes even if the model missed it", () => {
    const out = applyDiagnosisGuardrails({ causes: [cause({ name: "Air leak at brake chamber", safety_critical: false })], follow_up_questions: [] }, { triedOrRuledOut: [] });
    expect(out.causes[0].safety_critical).toBe(true);
    expect(out.stopAndInspect).toBe(true);
  });

  it("drops causes the user already ruled out and keeps tried ones flagged", () => {
    const out = applyDiagnosisGuardrails(
      { causes: [cause({ name: "Clogged fuel filter" }), cause({ name: "Failing lift pump" }), cause({ name: "Air in fuel lines" })], follow_up_questions: [] },
      { triedOrRuledOut: [{ name: "clogged  fuel filter", status: "ruled_out" }, { name: "Failing lift pump", status: "tried" }] },
    );
    expect(out.causes.map((c) => c.name)).toEqual(["Failing lift pump", "Air in fuel lines"]);
    expect(out.causes[0].tried).toBe(true);
  });

  it("caps the list and the question count", () => {
    const many = Array.from({ length: 15 }, (_, i) => cause({ name: `Cause ${i}` }));
    const out = applyDiagnosisGuardrails({ causes: many, follow_up_questions: Array(9).fill("q?") }, { triedOrRuledOut: [] });
    expect(out.causes).toHaveLength(8);
    expect(out.followUpQuestions).toHaveLength(3);
  });

  it("does not mark ordinary drivability causes safety-critical", () => {
    const out = applyDiagnosisGuardrails({ causes: [cause({ name: "Dirty MAF sensor", why: "Rough idle" })], follow_up_questions: [] }, { triedOrRuledOut: [] });
    expect(out.stopAndInspect).toBe(false);
  });
});
