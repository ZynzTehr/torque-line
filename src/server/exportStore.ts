import { asc, eq } from "drizzle-orm";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import * as schema from "@/db/schema";
import { csv, dateInZone, money, photoName, uniqueNames } from "@/domain/exportFormat";
import type { AppDb } from "./fleetStore";
import type { ObjectStore } from "./objectStore";

/** Bump when fleet.json changes shape in a way a reader would notice. */
export const EXPORT_FORMAT_VERSION = 1;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const byUnitNumber = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;

/** Every row the fleet owns, read up front so a database error fails the request before any bytes are sent. */
async function loadFleet(db: AppDb, fleetId: string) {
  const s = schema;
  const [[fleet], units, readings, schedules, records, stops, lines, sessions, causes, turns, attachments] = await Promise.all([
    db.select().from(s.fleets).where(eq(s.fleets.id, fleetId)),
    db.select().from(s.equipment).where(eq(s.equipment.fleetId, fleetId)),
    db.select().from(s.readings).where(eq(s.readings.fleetId, fleetId)).orderBy(asc(s.readings.observedAt), asc(s.readings.createdAt)),
    db.select().from(s.maintenanceSchedules).where(eq(s.maintenanceSchedules.fleetId, fleetId)).orderBy(asc(s.maintenanceSchedules.createdAt)),
    db.select().from(s.serviceRecords).where(eq(s.serviceRecords.fleetId, fleetId)).orderBy(asc(s.serviceRecords.date), asc(s.serviceRecords.createdAt)),
    db.select().from(s.fuelStops).where(eq(s.fuelStops.fleetId, fleetId)).orderBy(asc(s.fuelStops.date), asc(s.fuelStops.createdAt)),
    db.select().from(s.fuelLines).where(eq(s.fuelLines.fleetId, fleetId)).orderBy(asc(s.fuelLines.product)),
    db.select().from(s.diagnosticSessions).where(eq(s.diagnosticSessions.fleetId, fleetId)).orderBy(asc(s.diagnosticSessions.createdAt)),
    db.select().from(s.diagnosticCauses).where(eq(s.diagnosticCauses.fleetId, fleetId)).orderBy(asc(s.diagnosticCauses.rank)),
    db.select().from(s.diagnosticTurns).where(eq(s.diagnosticTurns.fleetId, fleetId)).orderBy(asc(s.diagnosticTurns.seq)),
    db.select().from(s.attachments).where(eq(s.attachments.fleetId, fleetId)).orderBy(asc(s.attachments.createdAt), asc(s.attachments.id)),
  ]);
  if (!fleet) throw new Error("Export requested for a fleet that does not exist");
  units.sort((x, y) => Number(!!x.archivedAt) - Number(!!y.archivedAt) || byUnitNumber(x.unitNumber, y.unitNumber));
  return { fleet, units, readings, schedules, records, stops, lines, sessions, causes, turns, attachments };
}

type Loaded = Awaited<ReturnType<typeof loadFleet>>;
type Photo = { path: string; storageKey: string; parentId: string };

/** A readable, unique receipts/ path for every attachment row, named after the record it belongs to. */
function namePhotos(d: Loaded): Photo[] {
  const unitNo = new Map(d.units.map((u) => [u.id, u.unitNumber]));
  const records = new Map(d.records.map((r) => [r.id, r]));
  const stops = new Map(d.stops.map((s) => [s.id, s]));
  const sessions = new Map(d.sessions.map((s) => [s.id, s]));
  const names = d.attachments.map((a) => {
    const base = { contentType: a.contentType };
    if (a.kind === "service_receipt") {
      const r = records.get(a.parentId);
      return photoName({ ...base, date: r?.date ?? "", units: r ? [unitNo.get(r.equipmentId) ?? ""] : [], label: r?.serviceType ?? "service" });
    }
    if (a.kind === "fuel_receipt") {
      const s = stops.get(a.parentId);
      const units = [...new Set(d.lines.filter((l) => l.stopId === a.parentId).map((l) => unitNo.get(l.equipmentId) ?? ""))];
      return photoName({ ...base, date: s?.date ?? "", units, label: `fuel ${s?.station ?? ""}` });
    }
    const s = sessions.get(a.parentId);
    return photoName({ ...base, date: s ? dateInZone(s.createdAt, d.fleet.timezone) : "", units: s ? [unitNo.get(s.equipmentId) ?? ""] : [],
      label: `diagnosis ${(s?.symptom ?? "").slice(0, 40)}` });
  });
  return uniqueNames(names).map((name, i) => ({ path: `receipts/${name}`, storageKey: d.attachments[i].storageKey, parentId: d.attachments[i].parentId }));
}

/** The CSVs and fleet.json, referencing only the photos that actually made it into the zip. */
function dataFiles(d: Loaded, included: Photo[], missing: string[], exportedAt: Date): [string, string][] {
  const unitNo = new Map(d.units.map((u) => [u.id, u.unitNumber]));
  const scheduleName = new Map(d.schedules.map((s) => [s.id, s.name]));
  const photosOf = new Map<string, string[]>();
  for (const p of included) photosOf.set(p.parentId, [...(photosOf.get(p.parentId) ?? []), p.path]);
  const photos = (id: string) => photosOf.get(id) ?? [];
  const linesOf = (stopId: string) => d.lines.filter((l) => l.stopId === stopId);
  const causesOf = (sessionId: string) => d.causes.filter((c) => c.sessionId === sessionId);

  const units = csv(
    ["unit_id", "unit_number", "type", "year", "make", "model", "engine", "vin", "odometer", "hours", "reading_updated_at", "notes", "status", "removed_at", "created_at"],
    d.units.map((u) => [u.id, u.unitNumber, u.type, u.year, u.make, u.model, u.engineSize, u.vin, u.currentMileage, u.currentHours,
      iso(u.readingUpdatedAt), u.notes, u.archivedAt ? "removed" : "active", iso(u.archivedAt), iso(u.createdAt)]),
  );
  const service = csv(
    ["record_id", "date", "unit_id", "unit_number", "service_type", "schedule_item_id", "schedule_item", "odometer", "hours", "cost", "shop", "notes", "receipt_files", "created_at"],
    d.records.map((r) => [r.id, r.date, r.equipmentId, unitNo.get(r.equipmentId), r.serviceType, r.scheduleId, r.scheduleId ? scheduleName.get(r.scheduleId) : null,
      r.mileage, r.hours, money(r.cost), r.shop, r.notes, photos(r.id).join("; "), iso(r.createdAt)]),
  );
  const fuel = csv(
    ["stop_id", "date", "station", "stop_total", "stop_notes", "line_id", "unit_id", "unit_number", "product", "gallons", "price_per_gallon", "subtotal", "odometer", "hours", "receipt_files"],
    d.stops.flatMap((s) => {
      const stop = [s.id, s.date, s.station, money(s.total), s.notes];
      const files = photos(s.id).join("; ");
      const lines = linesOf(s.id);
      if (!lines.length) return [[...stop, null, null, null, null, null, null, null, null, null, files]];
      return lines.map((l) => [...stop, l.id, l.equipmentId, unitNo.get(l.equipmentId), l.product, money(l.gallons, 3), money(l.pricePerGallon, 3),
        money(l.subtotal), l.odometer, l.hours, files]);
    }),
  );
  const readings = csv(
    ["reading_id", "observed_at", "unit_id", "unit_number", "meter", "value", "source", "confirmed_lower", "note", "created_at"],
    d.readings.map((r) => [r.id, iso(r.observedAt), r.equipmentId, unitNo.get(r.equipmentId), r.kind, r.value, r.source, r.confirmedLower, r.note, iso(r.createdAt)]),
  );
  const schedule = csv(
    ["item_id", "unit_id", "unit_number", "name", "category", "description", "every_miles", "every_days", "last_service_date", "last_service_odometer",
      "last_service_hours", "enabled", "source", "source_detail"],
    d.schedules.map((s) => [s.id, s.equipmentId, unitNo.get(s.equipmentId), s.name, s.category, s.description, s.mileageInterval, s.timeIntervalDays,
      s.lastServiceDate, s.lastServiceMileage, s.lastServiceHours, s.enabled, s.source, s.sourceDetail]),
  );
  const diagnostics = csv(
    ["session_id", "created_at", "unit_id", "unit_number", "symptom", "status", "resolution_note", "service_record_id", "photo_files"],
    d.sessions.map((s) => [s.id, iso(s.createdAt), s.equipmentId, unitNo.get(s.equipmentId), s.symptom, s.status, s.resolutionNote, s.serviceRecordId, photos(s.id).join("; ")]),
  );
  const causes = csv(
    ["cause_id", "session_id", "rank", "name", "likelihood", "why", "how_to_check", "cost_tier", "safety_critical", "needs_shop", "tried", "ruled_out"],
    d.causes.map((c) => [c.id, c.sessionId, c.rank, c.name, c.likelihood, c.why, c.howToCheck, c.costTier, c.safetyCritical, c.needsShop, c.tried, c.ruledOut]),
  );

  const json = {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    conventions: "Timestamps are ISO 8601 UTC; dates are YYYY-MM-DD. Money and gallons are decimal strings. Photo paths are relative to this file.",
    fleet: { id: d.fleet.id, name: d.fleet.name, timezone: d.fleet.timezone, createdAt: iso(d.fleet.createdAt) },
    units: d.units.map((u) => ({
      id: u.id, unitNumber: u.unitNumber, type: u.type, year: u.year, make: u.make, model: u.model, engine: u.engineSize, vin: u.vin,
      odometer: u.currentMileage, hours: u.currentHours, readingUpdatedAt: iso(u.readingUpdatedAt), notes: u.notes,
      removedAt: iso(u.archivedAt), createdAt: iso(u.createdAt), updatedAt: iso(u.updatedAt),
    })),
    readings: d.readings.map((r) => ({
      id: r.id, unitId: r.equipmentId, meter: r.kind, value: r.value, observedAt: iso(r.observedAt), source: r.source,
      confirmedLower: r.confirmedLower, note: r.note, createdAt: iso(r.createdAt),
    })),
    scheduleItems: d.schedules.map((s) => ({
      id: s.id, unitId: s.equipmentId, name: s.name, category: s.category, description: s.description, everyMiles: s.mileageInterval,
      everyDays: s.timeIntervalDays, lastServiceDate: s.lastServiceDate, lastServiceOdometer: s.lastServiceMileage, lastServiceHours: s.lastServiceHours,
      enabled: s.enabled, source: s.source, sourceDetail: s.sourceDetail, createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
    })),
    serviceRecords: d.records.map((r) => ({
      id: r.id, unitId: r.equipmentId, date: r.date, serviceType: r.serviceType, scheduleItemId: r.scheduleId, odometer: r.mileage, hours: r.hours,
      cost: money(r.cost), shop: r.shop, notes: r.notes, receiptFiles: photos(r.id), createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
    })),
    fuelStops: d.stops.map((s) => ({
      id: s.id, date: s.date, station: s.station, total: money(s.total), notes: s.notes, receiptFiles: photos(s.id),
      lines: linesOf(s.id).map((l) => ({
        id: l.id, unitId: l.equipmentId, product: l.product, gallons: money(l.gallons, 3), pricePerGallon: money(l.pricePerGallon, 3),
        subtotal: money(l.subtotal), odometer: l.odometer, hours: l.hours,
      })),
      createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
    })),
    diagnostics: d.sessions.map((s) => ({
      id: s.id, unitId: s.equipmentId, symptom: s.symptom, status: s.status, resolutionNote: s.resolutionNote, serviceRecordId: s.serviceRecordId,
      photoFiles: photos(s.id), createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt),
      causes: causesOf(s.id).map((c) => ({
        id: c.id, rank: c.rank, name: c.name, likelihood: c.likelihood, why: c.why, howToCheck: c.howToCheck, costTier: c.costTier,
        safetyCritical: c.safetyCritical, needsShop: c.needsShop, tried: c.tried, ruledOut: c.ruledOut,
      })),
      conversation: d.turns.filter((t) => t.sessionId === s.id).map((t) => ({ seq: t.seq, role: t.role, content: t.content, createdAt: iso(t.createdAt) })),
    })),
    missingFiles: missing,
  };

  return [
    ["units.csv", units], ["service-records.csv", service], ["fuel.csv", fuel], ["readings.csv", readings], ["schedule.csv", schedule],
    ["diagnostics.csv", diagnostics], ["diagnostic-causes.csv", causes], ["fleet.json", JSON.stringify(json, null, 2)],
  ];
}

/**
 * The fleet's whole history as a zip stream: receipts/ first (one photo in memory at a time, pulled only as
 * fast as the client reads), then the CSVs and fleet.json. A photo row whose object is gone from the bucket
 * is listed in fleet.json `missingFiles` instead of being referenced.
 */
export async function exportFleet(db: AppDb, store: ObjectStore, fleetId: string, now = new Date()): Promise<ReadableStream<Uint8Array>> {
  const loaded = await loadFleet(db, fleetId);
  const photos = namePhotos(loaded);
  const included: Photo[] = [];
  const missing: string[] = [];
  let next = 0;
  let zip: Zip;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((error, chunk, final) => {
        if (error) return controller.error(error);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    async pull() {
      // Each pull must enqueue something, or the stream stalls: skip past missing objects in one call.
      while (next < photos.length) {
        const photo = photos[next++];
        const object = await store.get(photo.storageKey);
        if (!object) { missing.push(photo.path); continue; }
        const entry = new ZipPassThrough(photo.path); // photos are already compressed
        entry.mtime = now;
        zip.add(entry);
        entry.push(object.bytes, true);
        included.push(photo);
        return;
      }
      const encoder = new TextEncoder();
      for (const [name, body] of dataFiles(loaded, included, missing, now)) {
        const entry = new ZipDeflate(name, { level: 6 });
        entry.mtime = now;
        zip.add(entry);
        entry.push(encoder.encode(body), true);
      }
      zip.end();
    },
  });
}
