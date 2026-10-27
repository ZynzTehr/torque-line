import { sql } from "drizzle-orm";
import type { AppDb } from "./fleetStore";

/** AppDb's raw execute is typed `unknown` across drivers; both the Neon and PGlite drivers answer `{ rows }`. */
const rowsOf = <T>(result: unknown) => (result as { rows: T[] }).rows;

/**
 * Neon Auth keeps its users, sessions and one-time tokens in the branch's own neon_auth schema. The app reads and
 * deletes there only for what the auth service has no setting for: ending sessions after a password reset, and
 * noticing an ended session before the SDK's session cache cookie expires.
 */

/** The user a password reset token belongs to, or null when it's unknown or expired. Tokens are stored in the clear. */
export async function resetTokenOwner(db: AppDb, token: string): Promise<string | null> {
  const rows = rowsOf<{ userId: string }>(await db.execute(sql`
    select value as "userId" from neon_auth.verification
    where identifier = ${`reset-password:${token}`} and "expiresAt" > now()
    order by "createdAt" desc limit 1`));
  return rows[0]?.userId ?? null;
}

/** Signs the user out everywhere. Returns how many sessions ended. */
export async function endAllSessions(db: AppDb, userId: string): Promise<number> {
  const rows = rowsOf<{ id: string }>(await db.execute(sql`delete from neon_auth.session where "userId" = ${userId}::uuid returning id`));
  return rows.length;
}

/** Whether a session still exists and hasn't expired. Ending one (sign-out, a reset, a password change) deletes its row. */
export async function sessionIsLive(db: AppDb, sessionToken: string): Promise<boolean> {
  const rows = rowsOf<{ live: number }>(await db.execute(sql`
    select 1 as live from neon_auth.session where token = ${sessionToken} and "expiresAt" > now() limit 1`));
  return rows.length > 0;
}
