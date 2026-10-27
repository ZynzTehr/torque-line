import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { resolveFleetForUser } from "@/server/fleetStore";
import { listFleetsForAdmin, platformRoleOf, setFleetStatus } from "@/server/adminStore";
import { createTestDb, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

const admin = { id: "user-admin", email: "owner@torqueline.app", name: "Jorge" };
const carol = { id: "user-carol", email: "carol@example.com", name: "Carol" };
const dave = { id: "user-dave", email: "dave@example.com", name: null };

describe("fleet owner details", () => {
  it("records the owner's email and when they were last active, and starts active", async () => {
    const ctx = await resolveFleetForUser(db, carol);
    expect(ctx.status).toBe("active");
    const [row] = await db.select().from(schema.fleets).where(eq(schema.fleets.id, ctx.fleetId));
    expect(row.ownerEmail).toBe("carol@example.com");
    expect(row.lastSeenAt).toBeInstanceOf(Date);
  });

  it("follows an email change on the next visit", async () => {
    const ctx = await resolveFleetForUser(db, { ...carol, email: "carol@newmail.com" });
    const [row] = await db.select().from(schema.fleets).where(eq(schema.fleets.id, ctx.fleetId));
    expect(row.ownerEmail).toBe("carol@newmail.com");
  });
});

describe("platform admin", () => {
  it("nobody is an admin until listed", async () => {
    expect(await platformRoleOf(db, admin.id)).toBeNull();
    await db.insert(schema.platformAdmins).values({ userId: admin.id });
    expect(await platformRoleOf(db, admin.id)).toBe("super");
    expect(await platformRoleOf(db, carol.id)).toBeNull();
  });

  it("lists every fleet with owner, status, units, and recent AI use, newest first", async () => {
    const adminFleet = await resolveFleetForUser(db, admin);
    const daveFleet = await resolveFleetForUser(db, dave);
    await db.insert(schema.equipment).values([
      { fleetId: daveFleet.fleetId, unitNumber: "7", normalizedUnitNumber: "7", type: "tractor" },
      { fleetId: daveFleet.fleetId, unitNumber: "8", normalizedUnitNumber: "8", type: "trailer" },
    ]);
    await db.insert(schema.aiUsage).values([
      { fleetId: daveFleet.fleetId, day: sql`current_date`, requests: 4 },
      { fleetId: daveFleet.fleetId, day: sql`current_date - 40`, requests: 9 },
    ]);
    await db.update(schema.fleets).set({ createdAt: sql`now() - interval '2 days'` }).where(eq(schema.fleets.id, adminFleet.fleetId));

    const rows = await listFleetsForAdmin(db);
    expect(rows.map((r) => r.ownerEmail)).toEqual(["dave@example.com", "carol@newmail.com", "owner@torqueline.app"]);
    expect(rows[0]).toMatchObject({ fleetId: daveFleet.fleetId, status: "active", unitCount: 2, aiRequests30d: 4, seenLast7d: true });
    expect(rows[1]).toMatchObject({ unitCount: 0, aiRequests30d: 0 });
  });

  it("an admin deactivates and reactivates a fleet, with a note", async () => {
    const carolFleet = await resolveFleetForUser(db, carol);
    const off = await setFleetStatus(db, admin.id, { fleetId: carolFleet.fleetId, status: "inactive", note: "Payment overdue" });
    expect(off).toEqual({ ok: true });
    expect((await resolveFleetForUser(db, carol)).status).toBe("inactive");
    const [row] = await db.select().from(schema.fleets).where(eq(schema.fleets.id, carolFleet.fleetId));
    expect(row).toMatchObject({ statusNote: "Payment overdue", statusChangedBy: admin.id });

    expect(await setFleetStatus(db, admin.id, { fleetId: carolFleet.fleetId, status: "active" })).toEqual({ ok: true });
    expect((await resolveFleetForUser(db, carol)).status).toBe("active");
  });

  it("refuses a non-admin, an admin's own fleet, and an unknown fleet", async () => {
    const daveFleet = await resolveFleetForUser(db, dave);
    const adminFleet = await resolveFleetForUser(db, admin);
    expect(await setFleetStatus(db, carol.id, { fleetId: daveFleet.fleetId, status: "inactive" })).toMatchObject({ ok: false, code: "forbidden" });
    expect((await resolveFleetForUser(db, dave)).status).toBe("active");
    expect(await setFleetStatus(db, admin.id, { fleetId: adminFleet.fleetId, status: "inactive" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await setFleetStatus(db, admin.id, { fleetId: "00000000-0000-0000-0000-000000000000", status: "inactive" })).toMatchObject({ ok: false, code: "not-found" });
  });
});
