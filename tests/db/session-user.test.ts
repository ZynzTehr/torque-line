import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../helpers/testDb";

// getSession stands in for the SDK answering from its session cache cookie: it says "signed in" whatever the database holds.
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: () => auth }));
vi.mock("@/db", () => ({ getDb: () => holder.db }));
vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.test");
vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "x".repeat(32));
const { getSessionUser } = await import("@/lib/auth/server");

let db: TestDb;
let close: () => Promise<void>;
const owner = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  holder.db = db;
  await db.execute(sql`create schema neon_auth`);
  await db.execute(sql`create table neon_auth.session (id uuid primary key default gen_random_uuid(), token text not null unique,
    "userId" uuid not null, "expiresAt" timestamptz not null default now() + interval '7 days')`);
});
afterAll(() => close());

beforeEach(async () => {
  await db.execute(sql`delete from neon_auth.session`);
  await db.execute(sql`insert into neon_auth.session (token, "userId") values ('live', ${owner})`);
  await db.execute(sql`insert into neon_auth.session (token, "userId", "expiresAt") values ('stale', ${owner}, now() - interval '1 minute')`);
});

const cookieSays = (token: string | undefined) => auth.getSession.mockResolvedValue({
  data: { session: { id: "s", token, userId: owner }, user: { id: owner, email: "owner@example.com", name: "Owner" } },
  error: null,
});

describe("getSessionUser", () => {
  it("returns the user while the session's row exists", async () => {
    cookieSays("live");
    expect(await getSessionUser()).toEqual({ id: owner, email: "owner@example.com", name: "Owner" });
  });

  it("signs out a device whose session was ended, though its cache cookie still says signed in", async () => {
    cookieSays("live");
    await db.execute(sql`delete from neon_auth.session where token = 'live'`);
    expect(await getSessionUser()).toBeNull();
  });

  it("signs out an expired session, and one with no token", async () => {
    cookieSays("stale");
    expect(await getSessionUser()).toBeNull();
    cookieSays(undefined);
    expect(await getSessionUser()).toBeNull();
  });

  it("returns null for an anonymous request", async () => {
    auth.getSession.mockResolvedValue({ data: null, error: null });
    expect(await getSessionUser()).toBeNull();
  });
});
