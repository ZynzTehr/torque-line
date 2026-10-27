import { strFromU8, unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { saveAttachment } from "@/server/attachmentsStore";
import { exportFleet, type ExportOptions, type ExportSummary } from "@/server/exportStore";
import { memoryObjectStore, type ObjectStore } from "@/server/objectStore";
import { createTestDb, seedFleet, type TestDb } from "../helpers/testDb";

let db: TestDb;
let close: () => Promise<void>;
const store = memoryObjectStore();
const jpeg = (marker: string) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(marker)]);
let a: { fleetId: string; equipmentId: string };
let b: { fleetId: string; equipmentId: string };
const ids: Record<string, string> = {};
let files: Record<string, Uint8Array>;

async function collect(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}
const text = (name: string) => strFromU8(files[name]);
/** Parse our own CSV output back into records (handles quoted fields with commas, quotes and newlines). */
function rows(name: string): Record<string, string>[] {
  const src = text(name).replace(/^﻿/, "");
  const table: string[][] = [[]];
  let cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { table.at(-1)!.push(cell); cell = ""; }
    else if (ch === "\r" && src[i + 1] === "\n") { table.at(-1)!.push(cell); cell = ""; table.push([]); i++; }
    else cell += ch;
  }
  const [header, ...body] = table.filter((r) => r.length);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = await seedFleet(db, { userId: "user-a", name: "Acme Haul" });
  b = await seedFleet(db, { userId: "user-b", unit: "B-SECRET-UNIT" });
  const actorA = { fleetId: a.fleetId, userId: "user-a" };

  const [reefer] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "R12", normalizedUnitNumber: "R12", type: "reefer", currentHours: 8420 }).returning();
  const [removed] = await db.insert(schema.equipment).values({ fleetId: a.fleetId, unitNumber: "T9", normalizedUnitNumber: "T9", type: "trailer", archivedAt: new Date("2026-09-01T15:00:00Z") }).returning();
  ids.reefer = reefer.id; ids.removed = removed.id;

  await db.insert(schema.readings).values({ fleetId: a.fleetId, equipmentId: a.equipmentId, kind: "odometer", value: 480000, observedAt: new Date("2026-10-01T12:00:00Z"), source: "manual", createdBy: "user-a" });
  const [oil] = await db.insert(schema.maintenanceSchedules).values({ fleetId: a.fleetId, equipmentId: a.equipmentId, name: "Oil change", category: "PM-A", mileageInterval: 25000, timeIntervalDays: 90, lastServiceDate: "2026-10-14" }).returning();
  ids.schedule = oil.id;
  const [rec] = await db.insert(schema.serviceRecords).values({
    fleetId: a.fleetId, equipmentId: a.equipmentId, date: "2026-10-14", serviceType: "Oil Change", scheduleId: oil.id,
    mileage: 480100, cost: 150, shop: "Joe's, Exit 12", notes: "=HYPERLINK(\"http://evil\")", createdBy: "user-a",
  }).returning();
  ids.record = rec.id;
  const saved = await saveAttachment(db, store, actorA, { kind: "service_receipt", parentId: rec.id, bytes: jpeg("SERVICE"), contentType: "image/jpeg" });
  if (!saved.ok) throw new Error(saved.message);

  const [stop] = await db.insert(schema.fuelStops).values({ fleetId: a.fleetId, date: "2026-10-15", station: "Pilot #4", total: 512.5, createdBy: "user-a" }).returning();
  ids.stop = stop.id;
  await db.insert(schema.fuelLines).values([
    { fleetId: a.fleetId, stopId: stop.id, equipmentId: a.equipmentId, product: "diesel", gallons: 120.5, pricePerGallon: 3.899, subtotal: 469.83, odometer: 480500 },
    { fleetId: a.fleetId, stopId: stop.id, equipmentId: reefer.id, product: "reefer", gallons: 11, pricePerGallon: 3.879, subtotal: 42.67, hours: 8430 },
  ]);
  await saveAttachment(db, store, actorA, { kind: "fuel_receipt", parentId: stop.id, bytes: jpeg("FUEL"), contentType: "image/png" });

  const [diag] = await db.insert(schema.diagnosticSessions).values({ fleetId: a.fleetId, equipmentId: removed.id, symptom: "Lights flicker", status: "resolved", resolutionNote: "Bad ground", createdBy: "user-a", createdAt: new Date("2026-10-15T03:00:00Z") }).returning();
  ids.diag = diag.id;
  await db.insert(schema.diagnosticCauses).values({ fleetId: a.fleetId, sessionId: diag.id, rank: 1, name: "Corroded ground", likelihood: "high", why: "Common", howToCheck: "Meter it", costTier: "low", tried: true });
  await db.insert(schema.diagnosticTurns).values({ fleetId: a.fleetId, sessionId: diag.id, seq: 1, role: "user", content: [{ type: "text", text: "Lights flicker" }] });
  await saveAttachment(db, store, actorA, { kind: "diagnostic_photo", parentId: diag.id, bytes: jpeg("DIAG"), contentType: "image/jpeg" });
  // A row whose object vanished from the bucket: the export must not point at a file it doesn't contain.
  const lost = await saveAttachment(db, store, actorA, { kind: "diagnostic_photo", parentId: diag.id, bytes: jpeg("LOST"), contentType: "image/jpeg" });
  if (!lost.ok) throw new Error("setup");
  await store.delete(lost.attachment.storageKey);
  await db.update(schema.attachments).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(schema.attachments.id, lost.attachment.id));

  // Fleet B: everything here must stay out of A's export.
  const [recB] = await db.insert(schema.serviceRecords).values({ fleetId: b.fleetId, equipmentId: b.equipmentId, date: "2026-10-14", serviceType: "B-SECRET-SERVICE", cost: 99, createdBy: "user-b" }).returning();
  await saveAttachment(db, store, { fleetId: b.fleetId, userId: "user-b" }, { kind: "service_receipt", parentId: recB.id, bytes: jpeg("B-SECRET-PHOTO"), contentType: "image/jpeg" });
  const [stopB] = await db.insert(schema.fuelStops).values({ fleetId: b.fleetId, date: "2026-10-15", station: "B-SECRET-STATION", total: 10, createdBy: "user-b" }).returning();
  await db.insert(schema.fuelLines).values({ fleetId: b.fleetId, stopId: stopB.id, equipmentId: b.equipmentId, product: "diesel", subtotal: 10 });

  files = unzipSync(await collect(await exportFleet(db, store, a.fleetId, { now: new Date("2026-10-27T15:00:00Z") })));
});
afterAll(() => close());

describe("owner data export", () => {
  it("contains the CSVs, fleet.json and one file per stored photo", () => {
    expect(Object.keys(files).sort()).toEqual([
      "diagnostic-causes.csv", "diagnostics.csv", "fleet.json", "fuel.csv", "readings.csv",
      "receipts/2026-10-14 T9 diagnosis lights flicker.jpg",
      "receipts/2026-10-14 101 oil change.jpg",
      "receipts/2026-10-15 101 R12 fuel pilot #4.png",
      "schedule.csv", "service-records.csv", "units.csv",
    ].sort());
    expect(strFromU8(files["receipts/2026-10-14 101 oil change.jpg"])).toContain("SERVICE");
    expect(strFromU8(files["receipts/2026-10-15 101 R12 fuel pilot #4.png"])).toContain("FUEL");
  });

  it("never includes another fleet's rows or files", () => {
    const everything = Object.values(files).map((f) => strFromU8(f)).join("\n");
    for (const secret of ["B-SECRET-UNIT", "B-SECRET-SERVICE", "B-SECRET-STATION", "B-SECRET-PHOTO", b.fleetId, b.equipmentId]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("lists every unit, marking removed ones", () => {
    const units = rows("units.csv");
    expect(units.map((u) => [u.unit_number, u.type, u.status, u.removed_at])).toEqual([
      ["101", "tractor", "active", ""],
      ["R12", "reefer", "active", ""],
      ["T9", "trailer", "removed", "2026-09-01T15:00:00.000Z"],
    ]);
  });

  it("writes service records with the schedule item, money as decimals, the photo name, and formula-safe text", () => {
    expect(rows("service-records.csv")).toEqual([expect.objectContaining({
      record_id: ids.record, date: "2026-10-14", unit_number: "101", service_type: "Oil Change", schedule_item: "Oil change",
      odometer: "480100", cost: "150.00", shop: "Joe's, Exit 12", notes: "'=HYPERLINK(\"http://evil\")",
      receipt_files: "receipts/2026-10-14 101 oil change.jpg",
    })]);
    expect(text("service-records.csv")).toContain('"\'=HYPERLINK(""http://evil"")"');
  });

  it("writes one fuel row per product line, with the stop's date, station and total on each", () => {
    expect(rows("fuel.csv").map((r) => ({ ...r, line_id: undefined }))).toEqual([
      { stop_id: ids.stop, date: "2026-10-15", station: "Pilot #4", stop_total: "512.50", stop_notes: "", line_id: undefined, unit_id: a.equipmentId, unit_number: "101",
        product: "diesel", gallons: "120.500", price_per_gallon: "3.899", subtotal: "469.83", odometer: "480500", hours: "", receipt_files: "receipts/2026-10-15 101 R12 fuel pilot #4.png" },
      { stop_id: ids.stop, date: "2026-10-15", station: "Pilot #4", stop_total: "512.50", stop_notes: "", line_id: undefined, unit_id: ids.reefer, unit_number: "R12",
        product: "reefer", gallons: "11.000", price_per_gallon: "3.879", subtotal: "42.67", odometer: "", hours: "8430", receipt_files: "receipts/2026-10-15 101 R12 fuel pilot #4.png" },
    ]);
  });

  it("writes readings, schedule items, diagnostics and causes", () => {
    expect(rows("readings.csv")).toEqual([expect.objectContaining({ unit_number: "101", meter: "odometer", value: "480000", observed_at: "2026-10-01T12:00:00.000Z", source: "manual" })]);
    expect(rows("schedule.csv")).toEqual([expect.objectContaining({ item_id: ids.schedule, unit_number: "101", name: "Oil change", category: "PM-A", every_miles: "25000", every_days: "90", last_service_date: "2026-10-14", enabled: "yes" })]);
    expect(rows("diagnostics.csv")).toEqual([expect.objectContaining({
      session_id: ids.diag, unit_number: "T9", symptom: "Lights flicker", status: "resolved", resolution_note: "Bad ground",
      photo_files: "receipts/2026-10-14 T9 diagnosis lights flicker.jpg",
    })]);
    expect(rows("diagnostic-causes.csv")).toEqual([expect.objectContaining({ session_id: ids.diag, rank: "1", name: "Corroded ground", likelihood: "high", tried: "yes", ruled_out: "no" })]);
  });

  it("puts everything in fleet.json with a format version, ISO dates and decimal-string money", () => {
    const json = JSON.parse(text("fleet.json"));
    expect(json.formatVersion).toBe(1);
    expect(json.exportedAt).toBe("2026-10-27T15:00:00.000Z");
    expect(json.fleet).toMatchObject({ id: a.fleetId, name: "Acme Haul", timezone: "America/Chicago" });
    expect(json.units.map((u: { unitNumber: string; removedAt: string | null }) => [u.unitNumber, u.removedAt])).toEqual([["101", null], ["R12", null], ["T9", "2026-09-01T15:00:00.000Z"]]);
    expect(json.serviceRecords[0]).toMatchObject({ id: ids.record, cost: "150.00", scheduleItemId: ids.schedule, receiptFiles: ["receipts/2026-10-14 101 oil change.jpg"] });
    expect(json.fuelStops[0]).toMatchObject({ id: ids.stop, total: "512.50", receiptFiles: ["receipts/2026-10-15 101 R12 fuel pilot #4.png"] });
    expect(json.fuelStops[0].lines.map((l: { product: string; subtotal: string; gallons: string }) => [l.product, l.subtotal, l.gallons])).toEqual([["diesel", "469.83", "120.500"], ["reefer", "42.67", "11.000"]]);
    expect(json.diagnostics[0]).toMatchObject({ id: ids.diag, causes: [{ name: "Corroded ground", tried: true }], conversation: [{ seq: 1, role: "user", content: [{ type: "text", text: "Lights flicker" }] }] });
    expect(json.readings).toHaveLength(1);
    expect(json.scheduleItems).toHaveLength(1);
    expect(json.missingFiles).toEqual(["receipts/2026-10-14 T9 diagnosis lights flicker (2).jpg"]);
    expect(json.unreadableFiles).toEqual([]);
    expect(json.skippedFiles).toEqual([]);
  });

  it("describes every photo in fleet.json, and dates the diagnosis causes", () => {
    const json = JSON.parse(text("fleet.json"));
    expect(json.photos).toEqual([
      { file: "receipts/2026-10-14 101 oil change.jpg", inZip: true, kind: "service_receipt", recordId: ids.record, contentType: "image/jpeg", byteSize: 11, uploadedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
      { file: "receipts/2026-10-15 101 R12 fuel pilot #4.png", inZip: true, kind: "fuel_receipt", recordId: ids.stop, contentType: "image/png", byteSize: 8, uploadedAt: expect.any(String) },
      { file: "receipts/2026-10-14 T9 diagnosis lights flicker.jpg", inZip: true, kind: "diagnostic_photo", recordId: ids.diag, contentType: "image/jpeg", byteSize: 8, uploadedAt: expect.any(String) },
      { file: "receipts/2026-10-14 T9 diagnosis lights flicker (2).jpg", inZip: false, kind: "diagnostic_photo", recordId: ids.diag, contentType: "image/jpeg", byteSize: 8, uploadedAt: expect.any(String) },
    ]);
    expect(json.diagnostics[0].causes[0]).toMatchObject({ createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), updatedAt: expect.any(String) });
  });
});

describe("export when storage misbehaves", () => {
  const unzipExport = async (s: ObjectStore, fleetId = a.fleetId, options: ExportOptions = {}) =>
    unzipSync(await collect(await exportFleet(db, s, fleetId, { now: new Date("2026-10-27T15:00:00Z"), ...options })));
  const keyOf = async (kind: "service_receipt" | "fuel_receipt") =>
    (await db.select().from(schema.attachments).where(eq(schema.attachments.kind, kind))).find((r) => r.fleetId === a.fleetId)!.storageKey;
  const providerError = () => Object.assign(new Error("socket hang up"), { name: "FilesError", code: "Provider" });

  it("finishes the zip when a photo can't be read, listing it as unreadable; a one-off failure is retried", async () => {
    const [serviceKey, fuelKey] = [await keyOf("service_receipt"), await keyOf("fuel_receipt")];
    let fuelFailures = 0;
    const flaky: ObjectStore = {
      ...store,
      async get(key) {
        if (key === serviceKey) throw providerError();
        if (key === fuelKey && fuelFailures++ === 0) throw providerError();
        return store.get(key);
      },
    };
    let summary: ExportSummary | undefined;
    const zip = await unzipExport(flaky, a.fleetId, { onDone: (x) => { summary = x; } });

    expect(Object.keys(zip).filter((n) => n.startsWith("receipts/")).sort()).toEqual([
      "receipts/2026-10-14 T9 diagnosis lights flicker.jpg", "receipts/2026-10-15 101 R12 fuel pilot #4.png",
    ]);
    const json = JSON.parse(strFromU8(zip["fleet.json"]));
    expect(json.unreadableFiles).toEqual(["receipts/2026-10-14 101 oil change.jpg"]);
    expect(json.missingFiles).toEqual(["receipts/2026-10-14 T9 diagnosis lights flicker (2).jpg"]);
    expect(json.serviceRecords[0].receiptFiles).toEqual([]);
    expect(strFromU8(zip["service-records.csv"])).not.toContain("oil change.jpg");
    expect(summary).toMatchObject({ photos: 2, missing: 1, unreadable: 1, errors: ["FilesError (Provider)"], cancelled: false });
  });

  it("fetches a few photos ahead of the reader, never more than four at once, keeping their order", async () => {
    const c = await seedFleet(db, { userId: "user-c", unit: "500" });
    const actorC = { fleetId: c.fleetId, userId: "user-c" };
    for (let day = 10; day < 20; day++) {
      const [r] = await db.insert(schema.serviceRecords).values({ fleetId: c.fleetId, equipmentId: c.equipmentId, date: `2026-09-${day}`, serviceType: "Wash", createdBy: "user-c" }).returning();
      await saveAttachment(db, store, actorC, { kind: "service_receipt", parentId: r.id, bytes: jpeg(`WASH-${day}`), contentType: "image/jpeg" });
      await db.update(schema.attachments).set({ createdAt: new Date(Date.UTC(2026, 8, day)) }).where(eq(schema.attachments.parentId, r.id));
    }
    let inFlight = 0, most = 0;
    const slow: ObjectStore = {
      ...store,
      async get(key) {
        most = Math.max(most, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return store.get(key);
      },
    };
    const zip = await unzipExport(slow, c.fleetId);

    expect(most).toBe(4);
    const photos = Object.keys(zip).filter((n) => n.startsWith("receipts/"));
    expect(photos).toEqual(Array.from({ length: 10 }, (_, i) => `receipts/2026-09-${10 + i} 500 wash.jpg`));
    expect(strFromU8(zip["receipts/2026-09-13 500 wash.jpg"])).toContain("WASH-13");
  });

  it("gives up on a photo storage never answers, aborting the request, and still finishes the zip", async () => {
    const serviceKey = await keyOf("service_receipt");
    const signals: AbortSignal[] = [];
    const hanging: ObjectStore = {
      ...store,
      get(key, options) {
        if (key !== serviceKey) return store.get(key);
        signals.push(options!.signal!);
        return new Promise(() => {});
      },
    };
    let summary: ExportSummary | undefined;
    const zip = await unzipExport(hanging, a.fleetId, { photoTimeoutMs: 20, onDone: (x) => { summary = x; } });

    expect(signals.map((s) => s.aborted)).toEqual([true, true]); // tried twice, each try cancelled
    const json = JSON.parse(strFromU8(zip["fleet.json"]));
    expect(json.unreadableFiles).toEqual(["receipts/2026-10-14 101 oil change.jpg"]);
    expect(Object.keys(zip).filter((n) => n.startsWith("receipts/")).sort()).toEqual([
      "receipts/2026-10-14 T9 diagnosis lights flicker.jpg", "receipts/2026-10-15 101 R12 fuel pilot #4.png",
    ]);
    expect(summary).toMatchObject({ photos: 2, unreadable: 1, errors: ["TimeoutError"], cancelled: false });
  });

  it("leaves the remaining photos out once the time budget is spent, so the zip still finishes", async () => {
    let gets = 0;
    const counting: ObjectStore = { ...store, get(key) { gets++; return store.get(key); } };
    let summary: ExportSummary | undefined;
    const zip = await unzipExport(counting, a.fleetId, { photoBudgetMs: 0, onDone: (x) => { summary = x; } });

    expect(gets).toBe(0);
    expect(Object.keys(zip).filter((n) => n.startsWith("receipts/"))).toEqual([]);
    const json = JSON.parse(strFromU8(zip["fleet.json"]));
    expect(json.skippedFiles).toEqual([
      "receipts/2026-10-14 101 oil change.jpg", "receipts/2026-10-15 101 R12 fuel pilot #4.png",
      "receipts/2026-10-14 T9 diagnosis lights flicker.jpg", "receipts/2026-10-14 T9 diagnosis lights flicker (2).jpg",
    ]);
    expect(json.serviceRecords[0].receiptFiles).toEqual([]);
    expect(strFromU8(zip["fuel.csv"])).not.toContain(".png");
    expect(summary).toMatchObject({ photos: 0, skipped: 4 });
  });

  it("stops adding photos before the zip outgrows what it can address, listing the rest as skipped", async () => {
    const zip = await unzipExport(store, a.fleetId, { maxPhotoBytes: 19 });

    expect(Object.keys(zip).filter((n) => n.startsWith("receipts/")).sort()).toEqual([
      "receipts/2026-10-14 101 oil change.jpg", "receipts/2026-10-15 101 R12 fuel pilot #4.png",
    ]);
    const json = JSON.parse(strFromU8(zip["fleet.json"]));
    expect(json.skippedFiles).toEqual(["receipts/2026-10-14 T9 diagnosis lights flicker.jpg"]);
    expect(json.missingFiles).toEqual(["receipts/2026-10-14 T9 diagnosis lights flicker (2).jpg"]);
  });
});
