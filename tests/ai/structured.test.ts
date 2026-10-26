import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { askStructured, type AiTransport } from "@/ai/structured";

const schema = z.object({ value: z.number() });
const ok = (parsed: unknown, extra: object = {}) => ({ stop_reason: "end_turn", parsed_output: parsed, model: "claude-opus-5-5", ...extra });

function transport(response: unknown): AiTransport & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, parse: vi.fn(async (params) => { calls.push(params); if (response instanceof Error) throw response; return response as never; }) };
}

describe("askStructured", () => {
  it("returns parsed data and the model that answered", async () => {
    const t = transport(ok({ value: 482150 }));
    const r = await askStructured(t, { schema, system: "s", content: [{ type: "text", text: "read" }], effort: "low" });
    expect(r).toEqual({ ok: true, data: { value: 482150 }, model: "claude-opus-5-5" });
  });

  it("sends Opus 5.5 with explicit effort, the default fallback, and no sampling parameters", async () => {
    const t = transport(ok({ value: 1 }));
    await askStructured(t, { schema, system: "s", content: [{ type: "text", text: "x" }], effort: "high" });
    const params = t.calls[0] as Record<string, unknown>;
    expect(params).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(params.output_config).toMatchObject({ effort: "high" });
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
  });

  it("reports a refusal as a typed result instead of reading content", async () => {
    const t = transport(ok(null, { stop_reason: "refusal", stop_details: { category: "general_harms" } }));
    expect(await askStructured(t, { schema, system: "s", content: [], effort: "low" })).toEqual({ ok: false, code: "refused" });
  });

  it("reports unparseable or truncated output as unreadable", async () => {
    expect(await askStructured(transport(ok(null)), { schema, system: "s", content: [], effort: "low" })).toEqual({ ok: false, code: "unreadable" });
    expect(await askStructured(transport(ok({ value: 1 }, { stop_reason: "max_tokens" })), { schema, system: "s", content: [], effort: "low" }))
      .toEqual({ ok: false, code: "unreadable" });
  });

  it("reports transport failures as unavailable without leaking the error", async () => {
    const r = await askStructured(transport(new Error("ECONNRESET secret-host")), { schema, system: "s", content: [], effort: "low" });
    expect(r).toEqual({ ok: false, code: "unavailable" });
  });
});
