import { and, eq, ne, notExists, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { AppDb } from "./fleetStore";
import { invalid, type Failure } from "./result";

/** Days between asking for deletion and the purge. Signing in before then can still restore the account. */
export const DELETION_GRACE_DAYS = 30;

/** A closed or deletion-scheduled account. An open account has no state row, so callers see null. */
export type AccountState =
  | { state: "closed"; purgeAfter: null }
  | { state: "deletion_scheduled"; purgeAfter: Date };

/** The state from an account_states row, or null when there is none (a left join's nulls included). */
export function toAccountState(state: AccountState["state"] | null, purgeAfter: Date | null): AccountState | null {
  if (state === "deletion_scheduled" && purgeAfter) return { state, purgeAfter };
  return state ? { state: "closed", purgeAfter: null } : null;
}

export async function accountStateOf(db: AppDb, userId: string): Promise<AccountState | null> {
  const [row] = await db.select({ state: schema.accountStates.state, purgeAfter: schema.accountStates.purgeAfter })
    .from(schema.accountStates).where(eq(schema.accountStates.userId, userId)).limit(1);
  return row ? toAccountState(row.state, row.purgeAfter) : null;
}

/**
 * Whether this user is a super admin and no other super admin has an open account. Closing their account, or
 * taking away their super role, would leave nobody able to manage the platform's admins.
 */
export async function isLastSuperAdmin(db: AppDb, userId: string): Promise<boolean> {
  const admins = schema.platformAdmins;
  const [self] = await db.select({ userId: admins.userId }).from(admins).where(and(eq(admins.userId, userId), eq(admins.role, "super"))).limit(1);
  if (!self) return false;
  const [other] = await db.select({ userId: admins.userId }).from(admins).where(and(
    ne(admins.userId, userId),
    eq(admins.role, "super"),
    notExists(db.select({ one: sql`1` }).from(schema.accountStates).where(eq(schema.accountStates.userId, admins.userId))),
  )).limit(1);
  return !other;
}

/**
 * Locks every platform_admins row for the rest of the transaction. Everything that could leave the platform without
 * a super admin (closing an account, changing or removing an admin) takes this lock first, so they queue up and
 * each one re-checks what the one before it wrote.
 */
export async function lockPlatformAdmins(tx: AppDb): Promise<void> {
  await tx.select({ userId: schema.platformAdmins.userId }).from(schema.platformAdmins).for("update");
}

const LAST_ADMIN = invalid("You're the only super admin. Make another admin a super admin before closing or deleting this account.");

/** Runs `write` unless it would take away the last open super admin account. */
async function unlessLastAdmin(db: AppDb, userId: string, write: (tx: AppDb) => Promise<unknown>): Promise<{ ok: true } | Failure> {
  return db.transaction(async (tx) => {
    await lockPlatformAdmins(tx);
    if (await isLastSuperAdmin(tx, userId)) return LAST_ADMIN;
    await write(tx);
    return { ok: true as const };
  });
}

/** Closes the account; nothing is deleted. Closing again is a no-op, and it never cancels a scheduled deletion. */
export async function closeAccount(db: AppDb, userId: string): Promise<{ ok: true } | Failure> {
  return unlessLastAdmin(db, userId, (tx) =>
    tx.insert(schema.accountStates).values({ userId, state: "closed" }).onConflictDoNothing({ target: schema.accountStates.userId }));
}

/**
 * Schedules the purge DELETION_GRACE_DAYS from now. A closed account moves to scheduled; asking again keeps the
 * first date, so the grace period can't be stretched by repeating the request.
 */
export async function scheduleAccountDeletion(db: AppDb, userId: string): Promise<{ ok: true; purgeAfter: Date } | Failure> {
  const purgeAfter = sql`now() + make_interval(days => ${DELETION_GRACE_DAYS})`;
  const written = await unlessLastAdmin(db, userId, (tx) => tx.insert(schema.accountStates).values({ userId, state: "deletion_scheduled", purgeAfter })
    .onConflictDoUpdate({
      target: schema.accountStates.userId,
      set: { state: "deletion_scheduled", purgeAfter, changedAt: sql`now()` },
      setWhere: eq(schema.accountStates.state, "closed"),
    }));
  if (!written.ok) return written;
  const state = await accountStateOf(db, userId);
  if (state?.state !== "deletion_scheduled") throw new Error("Deletion was not scheduled");
  return { ok: true, purgeAfter: state.purgeAfter };
}

/**
 * Reopens a closed account or cancels a scheduled deletion; nothing was deleted, so everything is back.
 * Allowed until the purge actually runs, which locks the row and re-checks it. An admin pause (fleets.status)
 * is separate and stays in force.
 */
export async function reopenAccount(db: AppDb, userId: string): Promise<{ ok: true; reopened: boolean }> {
  const removed = await db.delete(schema.accountStates).where(eq(schema.accountStates.userId, userId)).returning({ userId: schema.accountStates.userId });
  return { ok: true, reopened: removed.length > 0 };
}
