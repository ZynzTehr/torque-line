"use server";

import { getDb } from "@/db";
import { getAuth } from "@/lib/auth/server";
import { checkNewPassword, isInvalidResetLink, orThrow, passwordFailureMessage } from "@/lib/auth/errors";
import { endAllSessions, resetTokenOwner } from "@/server/authSessionsStore";
import { guarded } from "@/server/guarded";

const SESSIONS_NOT_ENDED =
  "Your password was changed, but other devices may still be signed in. Sign in, then change your password in Settings to sign them out.";

export type ResetPasswordResult = { ok: true } | { ok: false; code: "invalid-link" } | { ok: false; code: "failed"; message: string };

/**
 * Sets a new password from an emailed reset link, then signs the account out everywhere. Neon Auth has no setting
 * to end sessions on reset, so without this a leaked password would stay usable on every device signed in with it.
 * The token itself is the proof: whoever holds it could set the password anyway.
 */
export async function resetPasswordAction(token: string, newPassword: string) {
  return guarded("resetPasswordAction", async (): Promise<ResetPasswordResult> => {
    if (typeof token !== "string" || typeof newPassword !== "string") return { ok: false, code: "invalid-link" };
    const problem = checkNewPassword(newPassword, newPassword);
    if (problem) return { ok: false, code: "failed", message: problem };
    // Read before the reset: the auth service deletes the token once it's used.
    const userId = await resetTokenOwner(getDb(), token);
    if (!userId) return { ok: false, code: "invalid-link" };
    try {
      orThrow(await getAuth().resetPassword({ newPassword, token }));
    } catch (caught) {
      if (isInvalidResetLink(caught)) return { ok: false, code: "invalid-link" };
      return { ok: false, code: "failed", message: passwordFailureMessage(caught) };
    }
    try {
      await endAllSessions(getDb(), userId);
    } catch (caught) {
      console.error(`Ending sessions after a password reset failed: ${(caught as Error)?.name}`);
      return { ok: false, code: "failed", message: SESSIONS_NOT_ENDED };
    }
    return { ok: true };
  });
}
