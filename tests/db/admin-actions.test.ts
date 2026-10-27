import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listPlatformAdmins } from "@/server/adminStore";
import { resolveFleetForUser } from "@/server/fleetStore";
import { createTestDb, type TestDb } from "../helpers/testDb";

// The server actions as the browser calls them, with the session and database swapped for the test's.
const holder = vi.hoisted(() => ({ db: null as unknown, user: null as null | { id: string; email: string; name: string } }));
vi.mock("@/db", () => ({ getDb: () => holder.db }));
vi.mock("@/lib/auth/server", () => ({ getSessionUser: async () => holder.user, LOGIN_URL: "/auth/sign-in" }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ refresh: () => {} }));
const { addAdminAction, removeAdminAction, setAdminRoleAction, setFleetStatusAction } = await import("@/app/(app)/admin/actions");

let db: TestDb;
let close: () => Promise<void>;

const person = (n: number, name: string) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, email: `${name.toLowerCase()}@example.com`, name,
});
const sue = person(1, "Sue"); // super
const sam = person(3, "Sam"); // support
const olga = person(4, "Olga"); // owner, not an admin
let olgaFleet = "";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  holder.db = db;
  await db.execute(sql`create schema neon_auth`);
  await db.execute(sql`create table neon_auth."user" (id uuid primary key, email text not null, name text, "emailVerified" boolean not null default true)`);
  for (const p of [sue, sam, olga]) {
    await db.execute(sql`insert into neon_auth."user" (id, email, name) values (${p.id}::uuid, ${p.email}, ${p.name})`);
    await resolveFleetForUser(db, p);
  }
  olgaFleet = (await resolveFleetForUser(db, olga)).fleetId;
});
afterAll(() => close());

beforeEach(async () => {
  await db.delete(schema.platformAdmins);
  await db.insert(schema.platformAdmins).values([{ userId: sue.id, role: "super" }, { userId: sam.id, role: "support" }]);
});

const signedInAs = (p: typeof sue) => { holder.user = p; };
const roles = async () => Object.fromEntries((await listPlatformAdmins(db)).map((a) => [a.email, a.role]));
const FORBIDDEN = { ok: false, code: "forbidden", message: "You don't have access to that." };
const UNCHANGED = { "sue@example.com": "super", "sam@example.com": "support" };

describe("admin server actions", () => {
  it("refuse every admin-management action to a support admin", async () => {
    signedInAs(sam);
    expect(await addAdminAction("olga@example.com", "super")).toEqual(FORBIDDEN);
    expect(await setAdminRoleAction(sam.id, "super")).toEqual(FORBIDDEN);
    expect(await setAdminRoleAction(sue.id, "support")).toEqual(FORBIDDEN);
    expect(await removeAdminAction(sue.id)).toEqual(FORBIDDEN);
    expect(await roles()).toEqual(UNCHANGED);
  });

  it("let a support admin pause and reactivate an account", async () => {
    signedInAs(sam);
    expect(await setFleetStatusAction(olgaFleet, "inactive")).toEqual({ ok: true });
    expect(await setFleetStatusAction(olgaFleet, "active")).toEqual({ ok: true });
  });

  it("let a super admin manage admins", async () => {
    signedInAs(sue);
    expect(await addAdminAction("olga@example.com", "support")).toEqual({ ok: true });
    expect(await setAdminRoleAction(olga.id, "super")).toEqual({ ok: true });
    expect(await removeAdminAction(olga.id)).toEqual({ ok: true });
    expect(await roles()).toEqual(UNCHANGED);
  });

  it("404 someone who isn't an admin, whatever the action", async () => {
    signedInAs(olga);
    for (const call of [() => addAdminAction("olga@example.com", "super"), () => removeAdminAction(sue.id), () => setFleetStatusAction(olgaFleet, "inactive")]) {
      await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
    expect(await roles()).toEqual(UNCHANGED);
  });
});
