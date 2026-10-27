import { AuthApiError, isAuthApiError, isAuthError } from "@neondatabase/auth/next";

export const NETWORK_MESSAGE = "We couldn't reach the sign-in service. Check your connection and try again.";
export const PASSWORD_RULE = "Use 8 to 128 characters.";
const RATE_LIMITED = "Too many tries. Wait a minute and try again.";

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

/**
 * The SDK maps Better Auth's codes to its own (EMAIL_NOT_VERIFIED becomes email_not_confirmed, INVALID_TOKEN
 * becomes bad_jwt, INVALID_PASSWORD becomes invalid_credentials) and replaces the message for mapped codes.
 */
const codeOf = (error: unknown) => (isAuthApiError(error) ? error.code : undefined);
export const isRateLimited = (error: unknown) => isAuthApiError(error) && error.status === 429;

/** Sign-in was refused only because the email address hasn't been verified yet. */
export function needsEmailVerification(error: unknown): boolean {
  return codeOf(error) === "email_not_confirmed";
}

/** The reset token is unknown, expired, or already used. */
export function isInvalidResetLink(error: unknown): boolean {
  return codeOf(error) === "bad_jwt";
}

/** For a failed password change or reset. On a change, invalid_credentials can only mean the current password. */
export function passwordFailureMessage(error: unknown): string {
  if (isRateLimited(error)) return RATE_LIMITED;
  if (codeOf(error) === "invalid_credentials") return "Your current password is wrong.";
  if (codeOf(error) === "weak_password") return PASSWORD_RULE;
  return authFailureMessage(error);
}

/** For a failed email code check or resend. Better Auth's OTP errors are unmapped, so only their text tells them apart. */
export function codeFailureMessage(error: unknown): string {
  if (isRateLimited(error)) return RATE_LIMITED;
  const message = isAuthApiError(error) ? error.message.toLowerCase() : "";
  if (message.includes("too many attempts")) return "Too many wrong codes. Send a new one.";
  if (message.includes("expired")) return "That code has expired. Send a new one.";
  if (message.includes("invalid otp")) return "That code is wrong. Check the email and try again.";
  return authFailureMessage(error);
}

/** Checked in the browser before a reset or change, matching the server's 8..128 rule. Null when fine. */
export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < 8 || password.length > 128) return PASSWORD_RULE;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/**
 * The client throws for non-2xx answers, but its return type still has an `error` branch. Treat one as a throw too,
 * so a failure can never be shown as success.
 */
export function orThrow<R extends { error: { message?: string; status: number; code?: string } | null }>(result: R): R {
  if (result.error) throw new AuthApiError(result.error.message || "That didn't work. Try again.", result.error.status, result.error.code);
  return result;
}
