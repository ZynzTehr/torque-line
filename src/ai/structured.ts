import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/** Default model for every route; effort is tuned per task. */
export const AI_MODEL = "claude-opus-5-5";
/** Fast, low-cost model for photo reads. Opus answers whenever it can't. */
export const READ_MODEL = "claude-haiku-5-5";
export type AiModel = typeof AI_MODEL | typeof READ_MODEL;
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

/**
 * Lazily created SDK client; credentials come from ANTHROPIC_API_KEY on the server only. A key that is not
 * scoped to a workspace also needs ANTHROPIC_WORKSPACE_ID, which the SDK does not read on its own.
 */
export function anthropicTransport(): AiTransport | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!transport) {
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    const client = new Anthropic({
      maxRetries: 2, timeout: 90_000,
      ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
    });
    transport = { parse: (params) => client.beta.messages.parse(params as never) as never };
  }
  return transport;
}

type AskOptions<S extends z.ZodType> = {
  schema: S; system: string; content?: Content; messages?: Message[]; effort: Effort; maxTokens?: number; model?: AiModel;
};

/**
 * Ask Claude for output that must match `schema`. The model's answer is untrusted: it is parsed,
 * validated again with Zod, and every non-answer (refusal, truncation, invalid JSON, network) becomes
 * a typed failure the UI can turn into "enter it manually". Haiku has no server-side fallback, so any
 * Haiku non-answer is asked once more on Opus with the same prompt and schema.
 */
export async function askStructured<S extends z.ZodType>(t: AiTransport | null, opts: AskOptions<S>): Promise<AiResult<z.infer<S>>> {
  if (!t) return { ok: false, code: "not-configured" };
  const model = opts.model ?? AI_MODEL;
  const first = await askOnce(t, model, opts);
  if (first.ok || model === AI_MODEL) return first;
  return askOnce(t, AI_MODEL, opts);
}

async function askOnce<S extends z.ZodType>(t: AiTransport, model: AiModel, opts: AskOptions<S>): Promise<AiResult<z.infer<S>>> {
  try {
    const response = await t.parse({
      model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: opts.messages ?? [{ role: "user", content: opts.content ?? [] }],
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      // Sending fallbacks to Haiku keeps a refusal a refusal, so the beta goes on Opus requests only.
      ...(model === AI_MODEL ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
    });
    if (response.stop_reason === "refusal") return { ok: false, code: "refused" };
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) return { ok: false, code: "unreadable" };
    const checked = opts.schema.safeParse(response.parsed_output);
    if (!checked.success) return { ok: false, code: "unreadable" };
    return { ok: true, data: checked.data, model: response.model };
  } catch (error) {
    // The SDK parses structured output locally and throws a plain AnthropicError (not an APIError) when the
    // text is truncated or doesn't match the schema: that's unreadable output, not an outage.
    if (error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError)) return { ok: false, code: "unreadable" };
    // Log the class only; provider messages can echo request details.
    console.error("AI request failed:", error instanceof Anthropic.APIError ? `${error.name} ${error.status}` : (error as Error)?.name);
    return { ok: false, code: "unavailable" };
  }
}
