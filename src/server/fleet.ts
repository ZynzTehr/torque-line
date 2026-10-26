import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSessionUser, LOGIN_URL, type SessionUser } from "@/lib/auth/server";

export interface FleetContext {
  user: SessionUser;
  fleetId: string;
  fleetName: string;
}

/**
 * The one entry point for fleet-scoped server code. Resolves the signed-in user's fleet,
 * creating it with an owner membership on first sign-in (owner-only MVP: one fleet per user).
 * Never accepts a fleet id from the client.
 */
export async function requireFleet(): Promise<FleetContext> {
  await connection(); // per-user data: always render at request time, never at build
  const user = await getSessionUser();
  if (!user) redirect(LOGIN_URL);

  const db = getDb();
  const existing = await db
    .select({ fleetId: schema.fleets.id, fleetName: schema.fleets.name })
    .from(schema.memberships)
    .innerJoin(schema.fleets, eq(schema.fleets.id, schema.memberships.fleetId))
    .where(eq(schema.memberships.userId, user.id))
    .limit(1);
  if (existing[0]) return { user, ...existing[0] };

  const created = await db.transaction(async (tx) => {
    const [fleet] = await tx
      .insert(schema.fleets)
      .values({ name: user.name ? `${user.name}'s fleet` : "My fleet" })
      .returning({ id: schema.fleets.id, name: schema.fleets.name });
    // A concurrent first request may have created the membership already; keep the earliest.
    await tx.insert(schema.memberships).values({ fleetId: fleet.id, userId: user.id, role: "owner" }).onConflictDoNothing();
    return fleet;
  });
  return { user, fleetId: created.id, fleetName: created.name };
}
