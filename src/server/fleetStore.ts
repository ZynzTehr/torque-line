import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/** Any Drizzle Postgres database over this schema: Neon in the app, PGlite in tests. */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface FleetUser { id: string; email: string; name: string | null }
export interface FleetContext { user: FleetUser; fleetId: string; fleetName: string }

/**
 * The signed-in user's fleet, created with an owner membership on first sign-in.
 * Concurrent first requests converge on one fleet: the unique owner column makes the
 * losing insert a no-op, and it then reads the winner's committed row.
 */
export async function resolveFleetForUser(db: AppDb, user: FleetUser): Promise<FleetContext> {
  const existing = await db
    .select({ fleetId: schema.fleets.id, fleetName: schema.fleets.name })
    .from(schema.memberships)
    .innerJoin(schema.fleets, eq(schema.fleets.id, schema.memberships.fleetId))
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  if (existing[0]) return { user, ...existing[0] };

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.fleets)
      .values({ ownerUserId: user.id, name: user.name ? `${user.name}'s fleet` : "My fleet" })
      .onConflictDoNothing({ target: schema.fleets.ownerUserId })
      .returning({ id: schema.fleets.id, name: schema.fleets.name });
    if (created) {
      await tx.insert(schema.memberships).values({ fleetId: created.id, userId: user.id, role: "owner" });
      return { user, fleetId: created.id, fleetName: created.name };
    }
    const [owned] = await tx
      .select({ id: schema.fleets.id, name: schema.fleets.name })
      .from(schema.fleets)
      .where(eq(schema.fleets.ownerUserId, user.id));
    return { user, fleetId: owned.id, fleetName: owned.name };
  });
}
