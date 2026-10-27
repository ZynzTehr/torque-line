import { isAuthError } from "@neondatabase/auth/next";

export const NETWORK_MESSAGE = "We couldn't reach the sign-in service. Check your connection and try again.";

/**
 * What to tell the user when a sign-in, sign-up, or sign-out call throws. The Neon Auth client throws (rather than
 * returning `{ error }`) for every non-2xx answer, so "account already exists" arrives here too: show the
 * service's own message for those. Only a failed fetch is a connection problem. Anything else keeps its
 * class and message visible, so a browser-specific failure can be reported and diagnosed.
 */
export function authFailureMessage(error: unknown): string {
  if (isAuthError(error)) return error.message || "That didn't work. Check your details and try again.";
  if (error instanceof TypeError && /fetch|load failed|network/i.test(error.message)) return NETWORK_MESSAGE;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `Something went wrong. Please try again. (${detail.slice(0, 160)})`;
}
