import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { consumeAiRequest } from "@/server/aiQuota";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string };
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" });
  await db.update(schema.fleets).set({ aiDailyLimit: 3 }).where(eq(schema.fleets.id, a.fleetId));
});
afterAll(() => close());

describe("consumeAiRequest", () => {
  it("allows requests up to the fleet's daily limit, then refuses", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeAiRequest(db, a.fleetId, "2026-10-26"));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ ok: false, code: "quota", limit: 3 });
  });

  it("resets on a new day", async () => {
    expect(await consumeAiRequest(db, a.fleetId, "2026-10-27")).toMatchObject({ ok: true, used: 1 });
  });

  it("never exceeds the limit under concurrent requests", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeAiRequest(db, a.fleetId, "2026-10-28")));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});
