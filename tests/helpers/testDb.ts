import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

/** A fresh in-memory Postgres with the real migrations applied. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => client.close() };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

/** Seed a fleet with an owner and one tractor; returns their ids. */
export async function seedFleet(db: TestDb, opts: { userId: string; unit?: string; name?: string }) {
  const [fleet] = await db.insert(schema.fleets).values({ ownerUserId: opts.userId, name: opts.name ?? "Fleet" }).returning();
  await db.insert(schema.memberships).values({ fleetId: fleet.id, userId: opts.userId });
  const unit = opts.unit ?? "101";
  const [truck] = await db.insert(schema.equipment).values({
    fleetId: fleet.id, unitNumber: unit, normalizedUnitNumber: unit.toUpperCase(), type: "tractor", currentMileage: 480000,
  }).returning();
  return { fleetId: fleet.id, equipmentId: truck.id };
}
