// The admin row lock on real Neon Postgres (PGlite runs one connection, so it can't show two changes racing).
// Run: set -a; . ./.env.local; set +a; LIVE=1 npx vitest run tests/live
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { lockPlatformAdmins } from "@/server/accountStore";
import { platformRoleOf, setPlatformAdminRole } from "@/server/adminStore";

const live = Boolean(process.env.LIVE && process.env.DATABASE_URL);
const db = live ? getDb() : (null as never);
const stamp = Date.now();
const sue = `live-admin-sue-${stamp}`;
const pat = `live-admin-pat-${stamp}`;

describe.skipIf(!live)("two super admins demoting each other at once (live Neon)", () => {
  beforeAll(async () => {
    await db.insert(schema.platformAdmins).values([{ userId: sue, role: "super" }, { userId: pat, role: "super" }]);
  });
  afterAll(async () => {
    await db.delete(schema.platformAdmins).where(inArray(schema.platformAdmins.userId, [sue, pat]));
  });

  it("the second change waits for the first, then finds its admin is no longer super", async () => {
    // Pat's demotion of Sue is in flight: it holds the admin lock and has written, but not committed.
    let release!: () => void;
    let locked!: () => void;
    const holding = new Promise<void>((r) => { locked = r; });
    const first = db.transaction(async (tx) => {
      await lockPlatformAdmins(tx);
      await tx.update(schema.platformAdmins).set({ role: "support" }).where(eq(schema.platformAdmins.userId, sue));
      locked();
      await new Promise<void>((r) => { release = r; });
    });
    await holding;

    // Sue, still super as far as committed data says, demotes Pat at the same moment.
    let settled = false;
    const second = setPlatformAdminRole(db, sue, { userId: pat, role: "support" }).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 1500));
    expect(settled).toBe(false); // queued behind the lock

    release();
    await first;
    expect(await second).toEqual({ ok: false, code: "forbidden", message: "You don't have access to that." });
    expect([await platformRoleOf(db, sue), await platformRoleOf(db, pat)]).toEqual(["support", "super"]);
  }, 30_000);
});
