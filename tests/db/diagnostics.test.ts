import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendTurn, createSession, getSession, listSessions, markCause, replaceCauses, resolveSession } from "@/server/diagnosticsStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
const actorA = () => ({ fleetId: a.fleetId, userId: "user-a" });
const cause = (name: string, over: object = {}) => ({ name, likelihood: "medium" as const, why: "w", how_to_check: "c", cost_tier: "low" as const, safety_critical: false, needs_shop: false, tried: false, ...over });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" });
  b = await seedFleet(db, { userId: "user-b" });
});
afterAll(() => close());

describe("diagnostics store", () => {
  it("creates a session for the fleet's own unit only", async () => {
    expect(await createSession(db, actorA(), { equipmentId: a.equipmentId, symptom: "Loses power on grades" })).toMatchObject({ ok: true });
    expect(await createSession(db, actorA(), { equipmentId: b.equipmentId, symptom: "x" })).toMatchObject({ ok: false, code: "not-found" });
    expect(await createSession(db, actorA(), { equipmentId: a.equipmentId, symptom: "  " })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("keeps the conversation in order and append-only", async () => {
    const s = await createSession(db, actorA(), { equipmentId: a.equipmentId, symptom: "Hard start when cold" });
    if (!s.ok) throw new Error("setup");
    await appendTurn(db, a.fleetId, s.session.id, "user", [{ type: "text", text: "first" }]);
    await appendTurn(db, a.fleetId, s.session.id, "assistant", [{ type: "text", text: "second" }]);
    const view = await getSession(db, a.fleetId, s.session.id);
    expect(view?.turns.map((t) => [t.seq, t.role])).toEqual([[1, "user"], [2, "assistant"]]);
  });

  it("replaces the ranked list but keeps ruled-out causes and carries tried flags", async () => {
    const s = await createSession(db, actorA(), { equipmentId: a.equipmentId, symptom: "Power loss" });
    if (!s.ok) throw new Error("setup");
    await replaceCauses(db, a.fleetId, s.session.id, [cause("Fuel filter"), cause("Lift pump"), cause("Turbo hose")]);
    let view = await getSession(db, a.fleetId, s.session.id);
    const filter = view!.causes.find((c) => c.name === "Fuel filter")!;
    await markCause(db, a.fleetId, filter.id, "ruled_out");
    await markCause(db, a.fleetId, view!.causes.find((c) => c.name === "Lift pump")!.id, "tried");

    await replaceCauses(db, a.fleetId, s.session.id, [cause("Lift pump", { tried: true }), cause("Injector")]);
    view = await getSession(db, a.fleetId, s.session.id);
    expect(view!.causes.map((c) => [c.name, c.tried, c.ruledOut])).toEqual([
      ["Lift pump", true, false], ["Injector", false, false], ["Fuel filter", false, true],
    ]);
  });

  it("hides other fleets' sessions and causes", async () => {
    const s = await createSession(db, { fleetId: b.fleetId, userId: "user-b" }, { equipmentId: b.equipmentId, symptom: "Theirs" });
    if (!s.ok) throw new Error("setup");
    await replaceCauses(db, b.fleetId, s.session.id, [cause("Their cause")]);
    expect(await getSession(db, a.fleetId, s.session.id)).toBeNull();
    expect((await listSessions(db, a.fleetId)).map((x) => x.symptom)).not.toContain("Theirs");
    const theirCause = (await getSession(db, b.fleetId, s.session.id))!.causes[0];
    expect(await markCause(db, a.fleetId, theirCause.id, "ruled_out")).toMatchObject({ ok: false, code: "not-found" });
    expect(await resolveSession(db, a.fleetId, s.session.id, "done")).toMatchObject({ ok: false, code: "not-found" });
  });

  it("resolves a session with a note", async () => {
    const s = await createSession(db, actorA(), { equipmentId: a.equipmentId, symptom: "Squeal" });
    if (!s.ok) throw new Error("setup");
    expect(await resolveSession(db, a.fleetId, s.session.id, "Replaced idler pulley")).toMatchObject({ ok: true });
    expect((await getSession(db, a.fleetId, s.session.id))?.session).toMatchObject({ status: "resolved", resolutionNote: "Replaced idler pulley" });
  });
});
