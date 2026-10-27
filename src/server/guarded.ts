import "server-only";
import { unstable_rethrow } from "next/navigation";

export const UNEXPECTED = { ok: false as const, code: "unexpected" as const, message: "Something went wrong saving that. Please try again." };

/**
 * Server actions never throw to the browser: an unexpected error becomes a typed result so forms can recover.
 * Next's own control flow (redirect to sign-in, notFound) is re-thrown untouched. Logs the error class only.
 */
export async function guarded<T>(label: string, run: () => Promise<T>): Promise<T | typeof UNEXPECTED> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    const e = error as { name?: string; code?: string };
    console.error(`${label} failed: ${e?.name ?? typeof error}${e?.code ? ` (${e.code})` : ""}`);
    return UNEXPECTED;
  }
}
