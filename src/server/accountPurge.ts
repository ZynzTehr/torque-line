import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { descriptor, modelYear, monthOf, standardServiceType } from "@/domain/anonymize";
import type { AppDb } from "./fleetStore";
import type { ObjectStore } from "./objectStore";

type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** What created_by becomes on rows that outlive their author (a fleet another owner keeps). */
export const DELETED_USER = "deleted-user";

export interface PurgeSummary {
  /** Accounts purged by this run. */
  purged: number;
  /** Accounts whose purge failed and rolled back; the next run tries them again. */
  failed: number;
  /** Bucket objects deleted, and those that couldn't be (logged; nothing in the database points at them any more). */
  filesDeleted: number;
  filesLeft: number;
}

/**
 * Purges every account whose deletion came due. Each account is its own transaction, so one failure doesn't block
 * the rest; a purged account has no state row left, so re-running is safe and does nothing more.
 * Bucket objects go after the commit: a leftover object is unreachable, a rolled-back purge must keep its files.
 */
export async function purgeDueAccounts(db: AppDb, store: Pick<ObjectStore, "deletePrefix">): Promise<PurgeSummary> {
  const s = schema.accountStates;
  const due = await db.select({ userId: s.userId }).from(s)
    .where(and(eq(s.state, "deletion_scheduled"), lte(s.purgeAfter, sql`now()`))).orderBy(asc(s.purgeAfter));
  const summary: PurgeSummary = { purged: 0, failed: 0, filesDeleted: 0, filesLeft: 0 };
  for (const { userId } of due) {
    let fleetIds: string[];
    try {
      const result = await db.transaction((tx) => purgeAccount(tx, userId));
      if (!result) continue; // restored, or purged by a concurrent run, since the list was read
      fleetIds = result.fleetIds;
      summary.purged++;
    } catch (error) {
      summary.failed++;
      const e = error as { name?: string; code?: string };
      console.error(`account purge failed and rolled back: ${e?.name ?? typeof error}${e?.code ? ` (${e.code})` : ""}`);
      continue;
    }
    for (const fleetId of fleetIds) {
      try {
        const r = await store.deletePrefix(`fleets/${fleetId}/`);
        summary.filesDeleted += r.deleted;
        summary.filesLeft += r.failed;
      } catch (error) {
        summary.filesLeft++;
        console.error(`account purge: listing a purged fleet's files failed: ${(error as Error)?.name ?? typeof error}`);
      }
    }
  }
  if (summary.filesLeft) console.error(`account purge: ${summary.filesLeft} bucket objects could not be deleted; remove them by hand`);
  return summary;
}

/**
 * Removes one due account in the caller's transaction, or returns null when it is no longer due. A fleet with no
 * other owner is first summarized into the anonymized tables, then deleted with every row that hangs off it (all
 * fleet-scoped tables cascade from fleets). A fleet another owner shares stays; only this user's traces leave it.
 * Then their membership, admin row, state row and Neon Auth user go; sessions and accounts cascade from the user.
 */
async function purgeAccount(tx: Tx, userId: string): Promise<{ fleetIds: string[] } | null> {
  const s = schema.accountStates;
  const [due] = await tx.select({ userId: s.userId }).from(s)
    .where(and(eq(s.userId, userId), eq(s.state, "deletion_scheduled"), lte(s.purgeAfter, sql`now()`))).for("update");
  if (!due) return null;

  const m = schema.memberships;
  const viaMembership = await tx.select({ fleetId: m.fleetId }).from(m).where(eq(m.userId, userId));
  const viaOwner = await tx.select({ fleetId: schema.fleets.id }).from(schema.fleets).where(eq(schema.fleets.ownerUserId, userId));
  const purged: string[] = [];
  for (const fleetId of new Set([...viaMembership, ...viaOwner].map((r) => r.fleetId))) {
    const owned = tx.select({ one: sql`1` }).from(schema.fleets).where(eq(schema.fleets.ownerUserId, m.userId));
    const others = await tx.select({ userId: m.userId, ownsFleet: sql<boolean>`exists (${owned})` }).from(m)
      .where(and(eq(m.fleetId, fleetId), ne(m.userId, userId), eq(m.role, "owner"))).orderBy(asc(m.createdAt));
    if (!others.length) {
      await copyStatistics(tx, fleetId);
      purged.push(fleetId);
      continue;
    }
    // Shared fleet: it stays with the other owners. owner_user_id is unique (it is how a first sign-in finds the
    // fleet it created), so it passes to an owner with no fleet of their own, or else to a placeholder no user id
    // can match. owner_email refreshes on the next member's visit.
    const heir = others.find((o) => !o.ownsFleet)?.userId ?? `${DELETED_USER}:${fleetId}`;
    await tx.update(schema.fleets).set({ ownerUserId: heir, ownerEmail: null })
      .where(and(eq(schema.fleets.id, fleetId), eq(schema.fleets.ownerUserId, userId)));
  }
  if (purged.length) await tx.delete(schema.fleets).where(inArray(schema.fleets.id, purged));

  for (const t of [schema.readings, schema.serviceRecords, schema.fuelStops, schema.diagnosticSessions, schema.attachments]) {
    await tx.update(t).set({ createdBy: DELETED_USER }).where(eq(t.createdBy, userId));
  }
  await tx.update(schema.fleets).set({ statusChangedBy: null }).where(eq(schema.fleets.statusChangedBy, userId));
  await tx.delete(m).where(eq(m.userId, userId));
  await tx.delete(schema.platformAdmins).where(eq(schema.platformAdmins.userId, userId));
  await tx.delete(s).where(eq(s.userId, userId));
  await deleteAuthUser(tx, userId);
  return { fleetIds: purged };
}

/**
 * Neon Auth has no self-service delete endpoint, so the user row goes directly; their session, account and member
 * rows cascade from it. Rows that only name the user don't cascade and Better Auth drops them only when used:
 * pending one-time tokens (a reset token's value is the user id; email codes are keyed by the address, alone or
 * after "<type>-otp-"), invitations sent to the address, and sessions they started as an impersonating admin.
 * Matching the address inside a token row is a substring match: another address ending in this one would lose a
 * pending code, which asking for a new one fixes.
 */
async function deleteAuthUser(tx: Tx, userId: string) {
  const [user] = (await tx.execute(sql`delete from neon_auth."user" where id = ${userId}::uuid returning email`) as unknown as { rows: { email: string }[] }).rows;
  await tx.execute(sql`delete from neon_auth.session where "impersonatedBy" = ${userId}`);
  await tx.execute(sql`delete from neon_auth.verification where strpos(value, ${userId}) > 0`);
  if (!user?.email) return;
  const email = user.email.toLowerCase();
  await tx.execute(sql`delete from neon_auth.verification where strpos(lower(identifier), ${email}) > 0 or strpos(lower(value), ${email}) > 0`);
  await tx.execute(sql`delete from neon_auth.invitation where lower(email) = ${email}`);
}

async function insertAll<T extends PgTable>(tx: Tx, table: T, rows: T["$inferInsert"][]) {
  for (let i = 0; i < rows.length; i += 500) await tx.insert(table).values(rows.slice(i, i + 500));
}

/**
 * Copies a fleet's de-identified statistics. Each unit and diagnosis gets a fresh random reference that exists
 * only in these rows; free text is mapped to a fixed vocabulary or dropped, and dates are cut to the month.
 */
async function copyStatistics(tx: Tx, fleetId: string) {
  const s = schema;
  const units = await tx.select().from(s.equipment).where(eq(s.equipment.fleetId, fleetId));
  const unitOf = new Map(units.map((u) => [u.id, {
    unitRef: crypto.randomUUID(), equipmentType: u.type, year: modelYear(u.year), make: descriptor(u.make), model: descriptor(u.model),
  }]));
  const engineOf = new Map(units.map((u) => [u.id, descriptor(u.engineSize)]));
  const unit = (equipmentId: string) => unitOf.get(equipmentId)!;

  const services = await tx.select().from(s.serviceRecords).where(eq(s.serviceRecords.fleetId, fleetId));
  await insertAll(tx, s.anonServiceEvents, services.map((r) => ({
    ...unit(r.equipmentId), engineSize: engineOf.get(r.equipmentId),
    serviceType: standardServiceType(r.serviceType), mileage: r.mileage, hours: r.hours, cost: r.cost, month: monthOf(r.date),
  })));

  const fuel = await tx.select({ line: s.fuelLines, date: s.fuelStops.date }).from(s.fuelLines)
    .innerJoin(s.fuelStops, eq(s.fuelStops.id, s.fuelLines.stopId)).where(eq(s.fuelLines.fleetId, fleetId));
  await insertAll(tx, s.anonFuelLines, fuel.map(({ line, date }) => ({
    ...unit(line.equipmentId), product: line.product, gallons: line.gallons, pricePerGallon: line.pricePerGallon, month: monthOf(date),
  })));

  const month = sql<string>`to_char(date_trunc('month', ${s.readings.observedAt} at time zone 'UTC'), 'YYYY-MM-01')`;
  const readings = await tx.select({ equipmentId: s.readings.equipmentId, kind: s.readings.kind, month, value: sql<number>`max(${s.readings.value})::int` })
    .from(s.readings).where(eq(s.readings.fleetId, fleetId)).groupBy(s.readings.equipmentId, s.readings.kind, month);
  await insertAll(tx, s.anonMeterReadings, readings.map((r) => ({
    unitRef: unit(r.equipmentId).unitRef, kind: r.kind, month: r.month, value: r.value,
  })));

  const causes = await tx.select({ cause: s.diagnosticCauses, session: s.diagnosticSessions }).from(s.diagnosticCauses)
    .innerJoin(s.diagnosticSessions, and(eq(s.diagnosticSessions.fleetId, s.diagnosticCauses.fleetId), eq(s.diagnosticSessions.id, s.diagnosticCauses.sessionId)))
    .where(eq(s.diagnosticCauses.fleetId, fleetId));
  const sessionRef = new Map<string, string>();
  await insertAll(tx, s.anonDiagnosticOutcomes, causes.map(({ cause, session }) => {
    if (!sessionRef.has(session.id)) sessionRef.set(session.id, crypto.randomUUID());
    return {
      ...unit(session.equipmentId), sessionRef: sessionRef.get(session.id)!,
      causeName: cause.name.trim().slice(0, 120), likelihood: cause.likelihood, tried: cause.tried, ruledOut: cause.ruledOut,
      resolved: session.status === "resolved",
    };
  }));
}
