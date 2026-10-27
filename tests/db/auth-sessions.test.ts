import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { AuthApiError } from "@neondatabase/auth/next";
import { endAllSessions, resetTokenOwner } from "@/server/authSessionsStore";
import { createTestDb, type TestDb } from "../helpers/testDb";

// The reset action talks to the auth service and the database; both are stood in for here.
const auth = vi.hoisted(() => ({ resetPassword: vi.fn() }));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/auth/server", () => ({ getAuth: () => auth }));
vi.mock("@/db", () => ({ getDb: () => holder.db }));
const { resetPasswordAction } = await import("@/app/auth/actions");

let db: TestDb;
let close: () => Promise<void>;
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";

// The slice of Neon Auth's own schema these functions touch, shaped as on a real branch.
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  holder.db = db;
  await db.execute(sql`create schema neon_auth`);
  await db.execute(sql`create table neon_auth.session (id uuid primary key default gen_random_uuid(), token text not null,
    "userId" uuid not null, "expiresAt" timestamptz not null default now() + interval '7 days')`);
  await db.execute(sql`create table neon_auth.verification (id uuid primary key default gen_random_uuid(), identifier text not null,
    value text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz not null default now())`);
});
afterAll(() => close());

beforeEach(async () => {
  auth.resetPassword.mockReset();
  await db.execute(sql`delete from neon_auth.session`);
  await db.execute(sql`delete from neon_auth.verification`);
  await db.execute(sql`insert into neon_auth.session (token, "userId") values ('a', ${owner}), ('b', ${owner}), ('c', ${other})`);
  await db.execute(sql`insert into neon_auth.verification (identifier, value, "expiresAt") values
    ('reset-password:live', ${owner}, now() + interval '1 hour'),
    ('reset-password:stale', ${owner}, now() - interval '1 minute'),
    ('email-verification-otp-x@example.com', 'hash:0', now() + interval '5 minutes')`);
});

const sessionsOf = async (userId: string) =>
  ((await db.execute(sql`select token from neon_auth.session where "userId" = ${userId} order by token`)) as unknown as { rows: { token: string }[] })
    .rows.map((r) => r.token);

describe("resetTokenOwner", () => {
  it("finds the user for a live reset token only", async () => {
    expect(await resetTokenOwner(db, "live")).toBe(owner);
    expect(await resetTokenOwner(db, "stale")).toBeNull();
    expect(await resetTokenOwner(db, "nope")).toBeNull();
    expect(await resetTokenOwner(db, "%")).toBeNull();
  });
});

describe("endAllSessions", () => {
  it("ends every session of that user and no one else's", async () => {
    expect(await endAllSessions(db, owner)).toBe(2);
    expect(await sessionsOf(owner)).toEqual([]);
    expect(await sessionsOf(other)).toEqual(["c"]);
  });
});

describe("resetPasswordAction", () => {
  it("sets the password, then signs the account out everywhere", async () => {
    auth.resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    expect(await resetPasswordAction("live", "Wrench-123?")).toEqual({ ok: true });
    expect(auth.resetPassword).toHaveBeenCalledWith({ newPassword: "Wrench-123?", token: "live" });
    expect(await sessionsOf(owner)).toEqual([]);
    expect(await sessionsOf(other)).toEqual(["c"]);
  });

  it("calls an unknown or expired token an invalid link without asking the auth service", async () => {
    expect(await resetPasswordAction("stale", "Wrench-123?")).toEqual({ ok: false, code: "invalid-link" });
    expect(await resetPasswordAction("nope", "Wrench-123?")).toEqual({ ok: false, code: "invalid-link" });
    expect(auth.resetPassword).not.toHaveBeenCalled();
    expect(await sessionsOf(owner)).toEqual(["a", "b"]);
  });

  it("keeps sessions when the auth service refuses the reset", async () => {
    auth.resetPassword.mockResolvedValue({ data: null, error: { message: "Invalid token", status: 401, code: "bad_jwt" } });
    expect(await resetPasswordAction("live", "Wrench-123?")).toEqual({ ok: false, code: "invalid-link" });
    auth.resetPassword.mockRejectedValue(new AuthApiError("Too many requests.", 429, "over_request_rate_limit"));
    expect(await resetPasswordAction("live", "Wrench-123?")).toEqual({ ok: false, code: "failed", message: "Too many tries. Wait a minute and try again." });
    expect(await sessionsOf(owner)).toEqual(["a", "b"]);
  });

  it("checks the password rule before anything else", async () => {
    expect(await resetPasswordAction("live", "short")).toEqual({ ok: false, code: "failed", message: "Use 8 to 128 characters." });
    expect(auth.resetPassword).not.toHaveBeenCalled();
  });
});
