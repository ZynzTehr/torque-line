import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/** One model for every route; effort is tuned per task. */
export const AI_MODEL = "claude-opus-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export type Effort = "low" | "medium" | "high";

type Content = Anthropic.Beta.Messages.BetaContentBlockParam[];
type Message = Anthropic.Beta.Messages.BetaMessageParam;

/** The slice of the SDK this module uses, so tests can substitute a fake. */
export interface AiTransport {
  parse(params: Record<string, unknown>): Promise<{ stop_reason: string | null; parsed_output: unknown; model: string }>;
}

export type AiFailure = { ok: false; code: "refused" | "unreadable" | "unavailable" | "quota" | "not-configured" };
export type AiResult<T> = { ok: true; data: T; model: string } | AiFailure;

let transport: AiTransport | null = null;

/** Lazily created SDK client; credentials come from ANTHROPIC_API_KEY on the server only. */
export function anthropicTransport(): AiTransport | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!transport) {
    const client = new Anthropic({ maxRetries: 2, timeout: 90_000 });
    transport = { parse: (params) => client.beta.messages.parse(params as never) as never };
  }
  return transport;
}

/**
 * Ask Claude for output that must match `schema`. The model's answer is untrusted: it is parsed,
 * validated again with Zod, and every non-answer (refusal, truncation, invalid JSON, network) becomes
 * a typed failure the UI can turn into "enter it manually".
 */
export async function askStructured<S extends z.ZodType>(
  t: AiTransport | null,
  opts: { schema: S; system: string; content?: Content; messages?: Message[]; effort: Effort; maxTokens?: number },
): Promise<AiResult<z.infer<S>>> {
  if (!t) return { ok: false, code: "not-configured" };
  try {
    const response = await t.parse({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: opts.messages ?? [{ role: "user", content: opts.content ?? [] }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return { ok: false, code: "refused" };
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) return { ok: false, code: "unreadable" };
    const checked = opts.schema.safeParse(response.parsed_output);
    if (!checked.success) return { ok: false, code: "unreadable" };
    return { ok: true, data: checked.data, model: response.model };
  } catch (error) {
    // Log the class only; provider messages can echo request details.
    console.error("AI request failed:", error instanceof Anthropic.APIError ? `${error.name} ${error.status}` : (error as Error)?.name);
    return { ok: false, code: "unavailable" };
  }
}
