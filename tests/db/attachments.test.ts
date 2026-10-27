import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { listAttachments, readAttachment, saveAttachment } from "@/server/attachmentsStore";
import { memoryObjectStore } from "@/server/objectStore";
import { createSession } from "@/server/diagnosticsStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
let sessionA: string;
let sessionB: string;
const store = memoryObjectStore();
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a" });
  b = await seedFleet(db, { userId: "user-b" });
  const sa = await createSession(db, { fleetId: a.fleetId, userId: "user-a" }, { equipmentId: a.equipmentId, symptom: "noise" });
  const sb = await createSession(db, { fleetId: b.fleetId, userId: "user-b" }, { equipmentId: b.equipmentId, symptom: "noise" });
  if (!sa.ok || !sb.ok) throw new Error("setup");
  sessionA = sa.session.id; sessionB = sb.session.id;
});
afterAll(() => close());

describe("attachments", () => {
  it("stores bytes under a server-generated key prefixed by the fleet, and records the row", async () => {
    const r = await saveAttachment(db, store, { fleetId: a.fleetId, userId: "user-a" }, { kind: "diagnostic_photo", parentId: sessionA, bytes: jpeg, contentType: "image/jpeg" });
    if (!r.ok) throw new Error(r.message);
    expect(r.attachment.storageKey).toMatch(new RegExp(`^fleets/${a.fleetId}/diagnostic_photo/${sessionA}/[0-9a-f-]{36}\\.jpg$`));
    expect(store.keys()).toContain(r.attachment.storageKey);
    expect(await listAttachments(db, a.fleetId, "diagnostic_photo", sessionA)).toHaveLength(1);
  });

  it("refuses to attach to another fleet's record and stores nothing", async () => {
    const before = store.keys().length;
    const r = await saveAttachment(db, store, { fleetId: a.fleetId, userId: "user-a" }, { kind: "diagnostic_photo", parentId: sessionB, bytes: jpeg, contentType: "image/jpeg" });
    expect(r).toMatchObject({ ok: false, code: "not-found" });
    expect(store.keys().length).toBe(before);
  });

  it("serves a file only to its own fleet", async () => {
    const [row] = await listAttachments(db, a.fleetId, "diagnostic_photo", sessionA);
    expect(await readAttachment(db, store, a.fleetId, row.id)).toMatchObject({ contentType: "image/jpeg", bytes: jpeg });
    expect(await readAttachment(db, store, b.fleetId, row.id)).toBeNull();
    expect(await readAttachment(db, store, a.fleetId, "not-a-uuid")).toBeNull();
  });

  it("rejects unsupported content types and oversized files", async () => {
    const actor = { fleetId: a.fleetId, userId: "user-a" };
    expect(await saveAttachment(db, store, actor, { kind: "diagnostic_photo", parentId: sessionA, bytes: jpeg, contentType: "text/html" }))
      .toMatchObject({ ok: false, code: "invalid" });
    expect(await saveAttachment(db, store, actor, { kind: "diagnostic_photo", parentId: sessionA, bytes: new Uint8Array(3_000_001), contentType: "image/jpeg" }))
      .toMatchObject({ ok: false, code: "invalid" });
  });

  it("removes the uploaded object if the database write fails", async () => {
    const failing = { ...db, insert: () => { throw new Error("db down"); } } as unknown as TestDb;
    const before = store.keys().length;
    await expect(saveAttachment(failing, store, { fleetId: a.fleetId, userId: "user-a" }, { kind: "diagnostic_photo", parentId: sessionA, bytes: jpeg, contentType: "image/jpeg" })).rejects.toThrow();
    expect(store.keys().length).toBe(before);
  });

  it("validates receipt parents against service records and fuel stops", async () => {
    const [rec] = await db.insert(schema.serviceRecords).values({ fleetId: a.fleetId, equipmentId: a.equipmentId, date: "2026-10-01", serviceType: "Oil", createdBy: "user-a" }).returning();
    expect(await saveAttachment(db, store, { fleetId: a.fleetId, userId: "user-a" }, { kind: "service_receipt", parentId: rec.id, bytes: jpeg, contentType: "image/jpeg" })).toMatchObject({ ok: true });
    expect(await saveAttachment(db, store, { fleetId: a.fleetId, userId: "user-a" }, { kind: "fuel_receipt", parentId: rec.id, bytes: jpeg, contentType: "image/jpeg" })).toMatchObject({ ok: false, code: "not-found" });
  });
});
