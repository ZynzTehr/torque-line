import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { resolveFleetForUser } from "@/server/fleetStore";
import { createTestDb, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const alice = { id: "user-alice", email: "alice@example.com", name: "Alice" };
const bob = { id: "user-bob", email: "bob@example.com", name: null };

describe("resolveFleetForUser", () => {
  it("creates a fleet with an owner membership on first sign-in", async () => {
    const ctx = await resolveFleetForUser(db, alice);
    expect(ctx.fleetName).toBe("Alice's fleet");
    const members = await db.select().from(schema.memberships).where(eq(schema.memberships.fleetId, ctx.fleetId));
    expect(members).toEqual([expect.objectContaining({ userId: "user-alice", role: "owner" })]);
  });

  it("returns the same fleet on later sign-ins", async () => {
    const first = await resolveFleetForUser(db, alice);
    const second = await resolveFleetForUser(db, alice);
    expect(second.fleetId).toBe(first.fleetId);
    expect(await db.select().from(schema.fleets)).toHaveLength(1);
  });

  it("gives a different user their own fleet, named generically without a display name", async () => {
    const aliceCtx = await resolveFleetForUser(db, alice);
    const bobCtx = await resolveFleetForUser(db, bob);
    expect(bobCtx.fleetId).not.toBe(aliceCtx.fleetId);
    expect(bobCtx.fleetName).toBe("My fleet");
  });

  it("creates exactly one fleet when two first requests race", async () => {
    const carol = { id: "user-carol", email: "carol@example.com", name: "Carol" };
    const [x, y] = await Promise.all([resolveFleetForUser(db, carol), resolveFleetForUser(db, carol)]);
    expect(x.fleetId).toBe(y.fleetId);
    const owned = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, "user-carol"));
    expect(owned).toHaveLength(1);
  });
});
