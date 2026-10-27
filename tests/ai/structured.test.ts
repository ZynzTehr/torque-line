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

describe("askStructured on Haiku with an Opus retry", () => {
  /** Answers each call with the next response in order, echoing the requested model like the API does. */
  function sequence(...responses: unknown[]): AiTransport & { calls: Record<string, unknown>[]; limits: unknown[] } {
    const calls: Record<string, unknown>[] = [];
    const limits: unknown[] = [];
    return {
      calls,
      limits,
      parse: vi.fn(async (params, requestLimits) => {
        calls.push(params);
        limits.push(requestLimits);
        const next = responses[calls.length - 1];
        if (next instanceof Error) throw next;
        return { stop_reason: "end_turn", parsed_output: null, model: params.model as string, ...(next as object) };
      }),
    };
  }
  const ask = (t: AiTransport) =>
    askStructured(t, { schema, model: "claude-haiku-5-5", system: "s", content: [{ type: "text", text: "read" }], effort: "low", maxTokens: 2000 });

  it("answers from Haiku in one call, without the server-side fallback Haiku does not support", async () => {
    const t = sequence({ parsed_output: { value: 7 } });
    expect(await ask(t)).toEqual({ ok: true, data: { value: 7 }, model: "claude-haiku-5-5" });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 2000, output_config: { effort: "low" } });
    expect(t.calls[0]).not.toHaveProperty("fallbacks");
    expect(t.calls[0]).not.toHaveProperty("betas");
  });

  it.each([
    ["a refusal", { stop_reason: "refusal" }],
    ["unparseable output", { parsed_output: null }],
    ["output that fails the schema", { parsed_output: { value: "seven" } }],
    ["a truncated answer", { stop_reason: "max_tokens", parsed_output: { value: 7 } }],
    ["a network failure", new Error("ECONNRESET")],
  ])("retries once on Opus with the same prompt and schema after %s", async (_, haiku) => {
    const t = sequence(haiku, { parsed_output: { value: 482317 } });
    expect(await ask(t)).toEqual({ ok: true, data: { value: 482317 }, model: "claude-opus-5-5" });
    expect(t.calls).toHaveLength(2);
    const [first, retry] = t.calls;
    expect(retry).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    // The format carries a fresh parse function per request, so compare what is sent over the wire.
    for (const key of ["system", "messages", "output_config", "max_tokens"]) expect(JSON.stringify(retry[key])).toBe(JSON.stringify(first[key]));
    expect(JSON.stringify(retry.output_config)).toContain('"type":"json_schema"');
  });

  it("reports the Opus failure when both models fail, and never retries a third time", async () => {
    const t = sequence({ stop_reason: "refusal" }, { parsed_output: null });
    expect(await ask(t)).toEqual({ ok: false, code: "unreadable" });
    expect(t.calls).toHaveLength(2);
  });

  it("caps Haiku at 30s with one SDK retry and the Opus retry at one SDK retry, so both fit in a 300s function", async () => {
    const t = sequence(new Error("ETIMEDOUT"), { parsed_output: { value: 1 } });
    await ask(t);
    expect(t.limits).toEqual([{ timeout: 30_000, maxRetries: 1 }, { maxRetries: 1 }]);
  });

  it("leaves a direct Opus request on the client's default timeout and retries", async () => {
    const t = sequence({ parsed_output: { value: 1 } });
    await askStructured(t, { schema, system: "s", content: [], effort: "high" });
    expect(t.limits).toEqual([undefined]);
  });

  it("does not retry a failed Opus request", async () => {
    const t = sequence({ stop_reason: "refusal" }, { parsed_output: { value: 1 } });
    expect(await askStructured(t, { schema, system: "s", content: [], effort: "high" })).toEqual({ ok: false, code: "refused" });
    expect(t.calls).toHaveLength(1);
  });
});
