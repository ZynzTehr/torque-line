import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  addPlatformAdmin, listPlatformAdmins, platformRoleOf, removePlatformAdmin, setFleetStatus, setPlatformAdminRole,
} from "@/server/adminStore";
import { closeAccount, reopenAccount, scheduleAccountDeletion } from "@/server/accountStore";
import { resolveFleetForUser } from "@/server/fleetStore";
import { createTestDb, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;

const person = (n: number, name: string) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, email: `${name.toLowerCase()}@example.com`, name,
});
const sue = person(1, "Sue"); // super
const pat = person(2, "Pat"); // super
const sam = person(3, "Sam"); // support
const olga = person(4, "Olga"); // owner, not an admin

// Admins are added by the email Neon Auth holds, so the test needs the slice of its schema with users in it.
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.execute(sql`create schema neon_auth`);
  await db.execute(sql`create table neon_auth."user" (id uuid primary key, email text not null, name text)`);
  for (const p of [sue, pat, sam, olga]) {
    await db.execute(sql`insert into neon_auth."user" (id, email, name) values (${p.id}::uuid, ${p.email}, ${p.name})`);
    await resolveFleetForUser(db, p);
  }
});
afterAll(() => close());

beforeEach(async () => {
  await db.delete(schema.accountStates);
  await db.delete(schema.platformAdmins);
  await db.insert(schema.platformAdmins).values([{ userId: sue.id, role: "super" }, { userId: pat.id, role: "super" }, { userId: sam.id, role: "support" }]);
});

const roles = async () => Object.fromEntries((await listPlatformAdmins(db)).map((a) => [a.email, a.role]));
const FORBIDDEN = { ok: false, code: "forbidden", message: "You don't have access to that." };

describe("platform roles", () => {
  it("an existing admin row is a super admin unless told otherwise", async () => {
    await db.delete(schema.platformAdmins);
    await db.insert(schema.platformAdmins).values({ userId: sue.id });
    expect(await platformRoleOf(db, sue.id)).toBe("super");
    expect(await platformRoleOf(db, olga.id)).toBeNull();
  });

  it("lists every admin with their email and role, oldest first, then by email", async () => {
    await db.update(schema.platformAdmins).set({ createdAt: sql`now() - interval '1 day'` }).where(sql`${schema.platformAdmins.userId} = ${sam.id}`);
    expect((await listPlatformAdmins(db)).map((a) => [a.userId, a.email, a.role])).toEqual([
      [sam.id, "sam@example.com", "support"], [pat.id, "pat@example.com", "super"], [sue.id, "sue@example.com", "super"],
    ]);
  });

  it("support pauses and reactivates accounts, as admins always could", async () => {
    const olgaFleet = await resolveFleetForUser(db, olga);
    expect(await setFleetStatus(db, sam.id, { fleetId: olgaFleet.fleetId, status: "inactive" })).toEqual({ ok: true });
    expect(await setFleetStatus(db, sam.id, { fleetId: olgaFleet.fleetId, status: "active" })).toEqual({ ok: true });
    expect(await setFleetStatus(db, olga.id, { fleetId: olgaFleet.fleetId, status: "inactive" })).toEqual(FORBIDDEN);
  });
});

describe("a super admin manages admins", () => {
  it("adds an existing user by email, in any case and with spaces, with a role", async () => {
    expect(await addPlatformAdmin(db, sue.id, { email: "  OLGA@Example.com ", role: "support" })).toEqual({ ok: true });
    expect(await platformRoleOf(db, olga.id)).toBe("support");
  });

  it("refuses an email nobody signed up with, an existing admin, and an unknown role", async () => {
    expect(await addPlatformAdmin(db, sue.id, { email: "nobody@example.com", role: "support" }))
      .toEqual({ ok: false, code: "invalid", message: "No Torqueline account uses that email. They need to sign up first." });
    expect(await addPlatformAdmin(db, sue.id, { email: "sam@example.com", role: "super" }))
      .toEqual({ ok: false, code: "invalid", message: "sam@example.com is already an admin." });
    expect(await addPlatformAdmin(db, sue.id, { email: "olga@example.com", role: "owner" as never }))
      .toMatchObject({ ok: false, code: "invalid" });
    expect(await platformRoleOf(db, olga.id)).toBeNull();
  });

  it("changes another admin's role both ways", async () => {
    expect(await setPlatformAdminRole(db, sue.id, { userId: sam.id, role: "super" })).toEqual({ ok: true });
    expect(await setPlatformAdminRole(db, sue.id, { userId: pat.id, role: "support" })).toEqual({ ok: true });
    expect(await roles()).toEqual({ "sue@example.com": "super", "pat@example.com": "support", "sam@example.com": "super" });
  });

  it("removes another admin", async () => {
    expect(await removePlatformAdmin(db, sue.id, { userId: sam.id })).toEqual({ ok: true });
    expect(await removePlatformAdmin(db, sue.id, { userId: pat.id })).toEqual({ ok: true });
    expect(await roles()).toEqual({ "sue@example.com": "super" });
  });

  it("can't demote or remove themselves", async () => {
    expect(await setPlatformAdminRole(db, sue.id, { userId: sue.id, role: "support" }))
      .toEqual({ ok: false, code: "invalid", message: "You can't change your own role." });
    expect(await removePlatformAdmin(db, sue.id, { userId: sue.id }))
      .toEqual({ ok: false, code: "invalid", message: "You can't remove yourself." });
    expect(await platformRoleOf(db, sue.id)).toBe("super");
  });

  it("gets not-found for someone who isn't an admin", async () => {
    expect(await setPlatformAdminRole(db, sue.id, { userId: olga.id, role: "super" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await removePlatformAdmin(db, sue.id, { userId: olga.id })).toMatchObject({ ok: false, code: "not-found" });
  });
});

describe("there is always a super admin", () => {
  it("won't demote or remove the last super admin with an open account", async () => {
    // Sue's account is closed, so Pat is the only super admin who can still run the platform.
    await db.insert(schema.accountStates).values({ userId: sue.id, state: "closed" });
    const last = { ok: false, code: "invalid", message: "There must always be at least one super admin." };
    expect(await setPlatformAdminRole(db, sue.id, { userId: pat.id, role: "support" })).toEqual(last);
    expect(await removePlatformAdmin(db, sue.id, { userId: pat.id })).toEqual(last);
    expect(await platformRoleOf(db, pat.id)).toBe("super");
  });

  it("lets only one of two super admins demote the other when both try at once", async () => {
    const results = await Promise.all([
      setPlatformAdminRole(db, sue.id, { userId: pat.id, role: "support" }),
      setPlatformAdminRole(db, pat.id, { userId: sue.id, role: "support" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([FORBIDDEN]);
    expect(Object.values(await roles()).filter((r) => r === "super")).toHaveLength(1);
  });

  it("the only super admin can't close or delete their account while only support admins remain", async () => {
    await db.delete(schema.platformAdmins).where(sql`${schema.platformAdmins.userId} = ${pat.id}`);
    const refusal = { ok: false, code: "invalid", message: "You're the only super admin. Make another admin a super admin before closing or deleting this account." };
    expect(await closeAccount(db, sue.id)).toEqual(refusal);
    expect(await scheduleAccountDeletion(db, sue.id)).toEqual(refusal);
    // A support admin can leave; the platform still has its super admin.
    expect(await closeAccount(db, sam.id)).toEqual({ ok: true });
    await reopenAccount(db, sam.id);
  });
});

describe("a support admin can't manage admins", () => {
  it("is refused every admin-management action, whoever the target", async () => {
    expect(await addPlatformAdmin(db, sam.id, { email: "olga@example.com", role: "support" })).toEqual(FORBIDDEN);
    expect(await setPlatformAdminRole(db, sam.id, { userId: sam.id, role: "super" })).toEqual(FORBIDDEN);
    expect(await setPlatformAdminRole(db, sam.id, { userId: pat.id, role: "support" })).toEqual(FORBIDDEN);
    expect(await removePlatformAdmin(db, sam.id, { userId: pat.id })).toEqual(FORBIDDEN);
    expect(await removePlatformAdmin(db, sam.id, { userId: sam.id })).toEqual(FORBIDDEN);
    expect(await roles()).toEqual({ "sue@example.com": "super", "pat@example.com": "super", "sam@example.com": "support" });
  });

  it("and neither is someone who isn't an admin", async () => {
    expect(await addPlatformAdmin(db, olga.id, { email: "olga@example.com", role: "super" })).toEqual(FORBIDDEN);
    expect(await removePlatformAdmin(db, olga.id, { userId: sam.id })).toEqual(FORBIDDEN);
  });
});
