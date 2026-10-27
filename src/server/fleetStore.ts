import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/** Any Drizzle Postgres database over this schema: Neon in the app, PGlite in tests. */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface FleetUser { id: string; email: string; name: string | null }
export type FleetStatus = (typeof schema.fleetStatus.enumValues)[number];
export interface FleetContext { user: FleetUser; fleetId: string; fleetName: string; status: FleetStatus }

/** Refresh the owner's email and last-seen time, at most every 15 minutes per fleet. */
async function touchFleet(db: AppDb, fleetId: string, email: string) {
  await db.update(schema.fleets).set({ ownerEmail: email, lastSeenAt: sql`now()` }).where(and(
    eq(schema.fleets.id, fleetId),
    or(isNull(schema.fleets.lastSeenAt), lt(schema.fleets.lastSeenAt, sql`now() - interval '15 minutes'`),
      isNull(schema.fleets.ownerEmail), ne(schema.fleets.ownerEmail, email)),
  ));
}

/**
 * The signed-in user's fleet, created with an owner membership on first sign-in.
 * Concurrent first requests converge on one fleet: the unique owner column makes the
 * losing insert a no-op, and it then reads the winner's committed row.
 */
export async function resolveFleetForUser(db: AppDb, user: FleetUser): Promise<FleetContext> {
  const existing = await db
    .select({ fleetId: schema.fleets.id, fleetName: schema.fleets.name, status: schema.fleets.status })
    .from(schema.memberships)
    .innerJoin(schema.fleets, eq(schema.fleets.id, schema.memberships.fleetId))
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  if (existing[0]) {
    await touchFleet(db, existing[0].fleetId, user.email);
    return { user, ...existing[0] };
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.fleets)
      .values({ ownerUserId: user.id, name: user.name ? `${user.name}'s fleet` : "My fleet", ownerEmail: user.email, lastSeenAt: sql`now()` })
      .onConflictDoNothing({ target: schema.fleets.ownerUserId })
      .returning({ id: schema.fleets.id, name: schema.fleets.name, status: schema.fleets.status });
    if (created) {
      await tx.insert(schema.memberships).values({ fleetId: created.id, userId: user.id, role: "owner" });
      return { user, fleetId: created.id, fleetName: created.name, status: created.status };
    }
    const [owned] = await tx
      .select({ id: schema.fleets.id, name: schema.fleets.name, status: schema.fleets.status })
      .from(schema.fleets)
      .where(eq(schema.fleets.ownerUserId, user.id));
    return { user, fleetId: owned.id, fleetName: owned.name, status: owned.status };
  });
}
