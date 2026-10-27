"use server";

import { headers } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth/server";
import { verifyPassword } from "@/lib/auth/verifyPassword";
import { closeAccount, scheduleAccountDeletion } from "@/server/accountStore";
import { endAllSessions, endSession } from "@/server/authSessionsStore";
import { requireFleet } from "@/server/fleet";
import { guarded } from "@/server/guarded";
import { invalid } from "@/server/result";

/**
 * Signs this browser out (clearing its cookies), then ends every session row, which is what actually signs the
 * other devices out. The closed state is already saved, so a failed sign-out still can't reach the app.
 */
async function signOutEverywhere(userId: string) {
  await getAuth().signOut().catch(() => undefined);
  await endAllSessions(getDb(), userId);
}

/** "Close account": reversible, nothing is deleted. */
export async function closeAccountAction() {
  return guarded("closeAccountAction", async () => {
    const { user } = await requireFleet();
    const r = await closeAccount(getDb(), user.id);
    if (!r.ok) return r;
    await signOutEverywhere(user.id);
    return { ok: true as const };
  });
}

const PASSWORD_FAILURE = {
  wrong: "That password is wrong.",
  "rate-limited": "Too many tries. Wait a minute and try again.",
  unavailable: "We couldn't check your password right now. Please try again.",
} as const;

/**
 * "Delete account": the typed email must be the account's and the password is checked by the auth service.
 * The account is scheduled for the purge 30 days out (accountPurge.ts) and signed out everywhere.
 */
export async function deleteAccountAction(input: { email: string; password: string }) {
  return guarded("deleteAccountAction", async () => {
    const { user } = await requireFleet();
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input?.password === "string" ? input.password : "";
    if (email !== user.email.toLowerCase()) return invalid("That isn't the email on this account.");
    if (!password) return invalid("Enter your password.");

    const h = await headers();
    const origin = h.get("origin") ?? `https://${h.get("host")}`;
    const check = await verifyPassword({ baseUrl: process.env.NEON_AUTH_BASE_URL ?? "", origin, userId: user.id, email: user.email, password });
    if (!check.ok) return invalid(PASSWORD_FAILURE[check.reason]);
    if (check.sessionToken) await endSession(getDb(), check.sessionToken);

    const r = await scheduleAccountDeletion(getDb(), user.id);
    if (!r.ok) return r;
    await signOutEverywhere(user.id);
    return { ok: true as const };
  });
}
