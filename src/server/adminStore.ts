import { and, eq, gte, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { can, isPlatformRole, type PlatformRole } from "@/domain/adminPermissions";
import { isLastSuperAdmin, lockPlatformAdmins, toAccountState, type AccountState } from "./accountStore";
import type { AppDb, FleetStatus } from "./fleetStore";
import { forbidden, invalid, notFound, type Failure } from "./result";

/** The user's platform role, or null for everyone who isn't in platform_admins. */
export async function platformRoleOf(db: AppDb, userId: string): Promise<PlatformRole | null> {
  const [row] = await db.select({ role: schema.platformAdmins.role }).from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.userId, userId)).limit(1);
  return row?.role ?? null;
}

const asAdmin = (role: PlatformRole | null) => (role ? { role } : null);

export interface AdminFleetRow {
  fleetId: string;
  fleetName: string;
  ownerUserId: string;
  ownerEmail: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  seenLast7d: boolean;
  status: FleetStatus;
  statusNote: string | null;
  statusChangedAt: Date | null;
  unitCount: number;
  aiRequests30d: number;
  /** The owner closed the account or scheduled its deletion; null while it is open. */
  account: AccountState | null;
}

/** Every fleet, newest first, with the numbers an operator needs to judge an account. Callers must check can(…, "viewAccounts"). */
export async function listFleetsForAdmin(db: AppDb): Promise<AdminFleetRow[]> {
  const units = db.select({ fleetId: schema.equipment.fleetId, n: sql<number>`count(*)::int`.as("unit_count") })
    .from(schema.equipment).where(sql`${schema.equipment.archivedAt} is null`).groupBy(schema.equipment.fleetId).as("units");
  const ai = db.select({ fleetId: schema.aiUsage.fleetId, n: sql<number>`sum(${schema.aiUsage.requests})::int`.as("ai_count") })
    .from(schema.aiUsage).where(gte(schema.aiUsage.day, sql`current_date - 30`)).groupBy(schema.aiUsage.fleetId).as("ai");
  const f = schema.fleets;
  const a = schema.accountStates;
  const rows = await db.select({
    fleetId: f.id, fleetName: f.name, ownerUserId: f.ownerUserId, ownerEmail: f.ownerEmail, createdAt: f.createdAt,
    lastSeenAt: f.lastSeenAt, seenLast7d: sql<boolean>`coalesce(${f.lastSeenAt} > now() - interval '7 days', false)`, status: f.status, statusNote: f.statusNote, statusChangedAt: f.statusChangedAt,
    unitCount: sql<number>`coalesce(${units.n}, 0)`, aiRequests30d: sql<number>`coalesce(${ai.n}, 0)`,
    accountState: a.state, purgeAfter: a.purgeAfter,
  }).from(f)
    .leftJoin(units, eq(units.fleetId, f.id))
    .leftJoin(ai, eq(ai.fleetId, f.id))
    .leftJoin(a, eq(a.userId, f.ownerUserId))
    .orderBy(sql`${f.createdAt} desc`);
  return rows.map(({ accountState, purgeAfter, ...row }) => ({ ...row, account: toAccountState(accountState, purgeAfter) }));
}

export async function setFleetStatus(
  db: AppDb, actorUserId: string, input: { fleetId: string; status: FleetStatus; note?: string | null },
): Promise<{ ok: true } | Failure> {
  if (!can(asAdmin(await platformRoleOf(db, actorUserId)), "setFleetStatus")) return forbidden();
  if (input.status !== "active" && input.status !== "inactive") return invalid("Choose active or inactive.");
  const [fleet] = await db.select({ owner: schema.fleets.ownerUserId }).from(schema.fleets)
    .where(sql`${schema.fleets.id}::text = ${input.fleetId}`).limit(1);
  if (!fleet) return notFound("That fleet");
  if (fleet.owner === actorUserId && input.status === "inactive") return invalid("You can't deactivate your own fleet.");
  await db.update(schema.fleets).set({
    status: input.status,
    statusNote: input.note?.trim().slice(0, 500) || null,
    statusChangedAt: sql`now()`,
    statusChangedBy: actorUserId,
  }).where(and(eq(schema.fleets.id, input.fleetId)));
  return { ok: true };
}

export interface PlatformAdminRow {
  userId: string;
  /** Null only if the Neon Auth user is gone, which the purge never leaves behind. */
  email: string | null;
  role: PlatformRole;
  createdAt: Date;
}

/** Every platform admin, oldest first. Callers must check can(…, "manageAdmins"). */
export async function listPlatformAdmins(db: AppDb): Promise<PlatformAdminRow[]> {
  const rows = await db.execute(sql`
    select a.user_id as "userId", u.email, a.role, a.created_at as "createdAt"
    from platform_admins a left join neon_auth."user" u on u.id::text = a.user_id
    order by a.created_at, u.email`);
  return (rows as unknown as { rows: PlatformAdminRow[] }).rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }));
}

/**
 * Runs an admin-management change for `actorUserId`. The actor's role is read after locking every admin row, so
 * two super admins demoting each other at once can't both succeed: the second finds it is no longer a super admin.
 */
async function managingAdmins(
  db: AppDb, actorUserId: string, change: (tx: AppDb) => Promise<{ ok: true } | Failure>,
): Promise<{ ok: true } | Failure> {
  return db.transaction(async (tx) => {
    await lockPlatformAdmins(tx);
    if (!can(asAdmin(await platformRoleOf(tx, actorUserId)), "manageAdmins")) return forbidden();
    return change(tx);
  });
}

const LAST_SUPER = invalid("There must always be at least one super admin.");
const CHOOSE_ROLE = invalid("Choose super or support.");

/** Makes an existing Neon Auth user an admin, found by the email they sign in with. */
export async function addPlatformAdmin(
  db: AppDb, actorUserId: string, input: { email: string; role: PlatformRole },
): Promise<{ ok: true } | Failure> {
  return managingAdmins(db, actorUserId, async (tx) => {
    if (!isPlatformRole(input.role)) return CHOOSE_ROLE;
    const email = input.email.trim().toLowerCase();
    const found = await tx.execute(sql`select id::text as id from neon_auth."user" where lower(email) = ${email} limit 1`);
    const [user] = (found as unknown as { rows: { id: string }[] }).rows;
    if (!user) return invalid("No Torqueline account uses that email. They need to sign up first.");
    const added = await tx.insert(schema.platformAdmins).values({ userId: user.id, role: input.role })
      .onConflictDoNothing({ target: schema.platformAdmins.userId }).returning({ userId: schema.platformAdmins.userId });
    return added.length ? { ok: true } : invalid(`${email} is already an admin.`);
  });
}

export async function setPlatformAdminRole(
  db: AppDb, actorUserId: string, input: { userId: string; role: PlatformRole },
): Promise<{ ok: true } | Failure> {
  return managingAdmins(db, actorUserId, async (tx) => {
    if (!isPlatformRole(input.role)) return CHOOSE_ROLE;
    if (input.userId === actorUserId) return invalid("You can't change your own role.");
    const current = await platformRoleOf(tx, input.userId);
    if (!current) return notFound("That admin");
    if (input.role !== "super" && await isLastSuperAdmin(tx, input.userId)) return LAST_SUPER;
    await tx.update(schema.platformAdmins).set({ role: input.role }).where(eq(schema.platformAdmins.userId, input.userId));
    return { ok: true };
  });
}

/** Takes away someone's admin access. Their own account and fleet are untouched. */
export async function removePlatformAdmin(
  db: AppDb, actorUserId: string, input: { userId: string },
): Promise<{ ok: true } | Failure> {
  return managingAdmins(db, actorUserId, async (tx) => {
    if (input.userId === actorUserId) return invalid("You can't remove yourself.");
    if (!(await platformRoleOf(tx, input.userId))) return notFound("That admin");
    if (await isLastSuperAdmin(tx, input.userId)) return LAST_SUPER;
    await tx.delete(schema.platformAdmins).where(eq(schema.platformAdmins.userId, input.userId));
    return { ok: true };
  });
}
