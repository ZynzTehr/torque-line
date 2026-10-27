/**
 * Tenant model: every business row carries fleet_id. Child rows reference their parent through a
 * composite (fleet_id, id) foreign key, so the database itself refuses a cross-fleet link even if
 * application code has a bug. Money is numeric(12,2); readings are integers.
 */
import { sql } from "drizzle-orm";
import {
  boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, text,
  timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

export const equipmentType = pgEnum("equipment_type", ["tractor", "trailer", "reefer"]);
export const memberRole = pgEnum("member_role", ["owner"]);
export const meterKind = pgEnum("meter_kind", ["odometer", "hours"]);
export const readingSource = pgEnum("reading_source", ["manual", "photo", "service", "fuel"]);
export const pmCategory = pgEnum("pm_category", ["PM-A", "PM-B", "PM-C", "Annual"]);
export const intervalSource = pgEnum("interval_source", ["manual", "template", "ai_accepted"]);
export const fuelProduct = pgEnum("fuel_product", ["diesel", "def", "reefer"]);
export const diagnosticStatus = pgEnum("diagnostic_status", ["open", "resolved"]);
export const diagnosticRole = pgEnum("diagnostic_role", ["user", "assistant"]);
export const likelihood = pgEnum("likelihood", ["high", "medium", "low"]);
export const costTier = pgEnum("cost_tier", ["free", "low", "medium", "high"]);
export const fleetStatus = pgEnum("fleet_status", ["active", "inactive"]);
export const attachmentKind = pgEnum("attachment_kind", ["diagnostic_photo", "service_receipt", "fuel_receipt"]);

/** MVP invariant: a user owns at most one fleet (unique owner). Multi-fleet access comes later through memberships. */
export const fleets = pgTable("fleets", {
  id: id(),
  ownerUserId: text("owner_user_id").notNull().unique("fleets_owner_user"),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  aiDailyLimit: integer("ai_daily_limit").notNull().default(100),
  createdAt: createdAt(),
  /** Copied from the auth user on each visit, so the admin list needs no join into Neon Auth's schema. */
  ownerEmail: text("owner_email"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /** Set by a platform admin. An inactive fleet keeps its data but cannot use the app. */
  status: fleetStatus("status").notNull().default("active"),
  statusNote: text("status_note"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  statusChangedBy: text("status_changed_by"),
});

/** Torqueline operators. Rows are added by hand (SQL), never through the app. */
export const platformAdmins = pgTable("platform_admins", {
  userId: text("user_id").primaryKey(),
  createdAt: createdAt(),
});

/** userId is the Neon Auth (Better Auth) user id. Owner-only for the MVP. */
export const memberships = pgTable("memberships", {
  id: id(),
  fleetId: uuid("fleet_id").notNull().references(() => fleets.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: memberRole("role").notNull().default("owner"),
  createdAt: createdAt(),
}, (t) => [
  unique("memberships_fleet_user").on(t.fleetId, t.userId),
  index("memberships_user").on(t.userId),
]);

export const equipment = pgTable("equipment", {
  id: id(),
  fleetId: uuid("fleet_id").notNull().references(() => fleets.id, { onDelete: "cascade" }),
  unitNumber: text("unit_number").notNull(),
  normalizedUnitNumber: text("normalized_unit_number").notNull(),
  type: equipmentType("type").notNull(),
  year: text("year"),
  make: text("make"),
  model: text("model"),
  engineSize: text("engine_size"),
  vin: text("vin"),
  /** Projection of the latest accepted reading; history lives in readings. */
  currentMileage: integer("current_mileage"),
  currentHours: integer("current_hours"),
  readingUpdatedAt: timestamp("reading_updated_at", { withTimezone: true }),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique("equipment_fleet_id").on(t.fleetId, t.id),
  // Removed (archived) units keep their history but free their unit number for reuse.
  uniqueIndex("equipment_fleet_unit").on(t.fleetId, t.normalizedUnitNumber).where(sql`${t.archivedAt} is null`),
  check("equipment_readings_nonneg", sql`coalesce(${t.currentMileage}, 0) >= 0 and coalesce(${t.currentHours}, 0) >= 0`),
]);

const tenantEquipmentFk = (name: string, fleetId: Parameters<typeof foreignKey>[0]["columns"][0], equipmentId: Parameters<typeof foreignKey>[0]["columns"][0]) =>
  foreignKey({ name, columns: [fleetId, equipmentId], foreignColumns: [equipment.fleetId, equipment.id] }).onDelete("cascade");

/** Append-only meter history. A lower value is stored only after explicit confirmation (note required). */
export const readings = pgTable("readings", {
  id: id(),
  fleetId: uuid("fleet_id").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  kind: meterKind("kind").notNull(),
  value: integer("value").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  source: readingSource("source").notNull().default("manual"),
  confirmedLower: boolean("confirmed_lower").notNull().default(false),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [
  tenantEquipmentFk("readings_equipment_fk", t.fleetId, t.equipmentId),
  index("readings_equipment_observed").on(t.equipmentId, t.observedAt),
  check("readings_value_nonneg", sql`${t.value} >= 0`),
  check("readings_lower_has_note", sql`not ${t.confirmedLower} or length(coalesce(${t.note}, '')) > 0`),
]);

export const maintenanceSchedules = pgTable("maintenance_schedules", {
  id: id(),
  fleetId: uuid("fleet_id").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  name: text("name").notNull(),
  category: pmCategory("category").notNull(),
  description: text("description"),
  mileageInterval: integer("mileage_interval"),
  timeIntervalDays: integer("time_interval_days"),
  lastServiceMileage: integer("last_service_mileage"),
  /** Reefer engine hours at last service; reefer schedules trigger on time, hours are kept for the record. */
  lastServiceHours: integer("last_service_hours"),
  lastServiceDate: date("last_service_date"),
  enabled: boolean("enabled").notNull().default(true),
  source: intervalSource("source").notNull().default("manual"),
  sourceDetail: text("source_detail"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  tenantEquipmentFk("schedules_equipment_fk", t.fleetId, t.equipmentId),
  index("schedules_equipment").on(t.equipmentId),
  check("schedules_has_trigger", sql`${t.mileageInterval} is not null or ${t.timeIntervalDays} is not null`),
  check("schedules_positive", sql`coalesce(${t.mileageInterval}, 1) > 0 and coalesce(${t.timeIntervalDays}, 1) > 0`),
]);

export const serviceRecords = pgTable("service_records", {
  id: id(),
  fleetId: uuid("fleet_id").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  date: date("date").notNull(),
  serviceType: text("service_type").notNull(),
  /** The schedule item this service completed, so editing or deleting the record can recompute its baseline. */
  scheduleId: uuid("schedule_id").references(() => maintenanceSchedules.id, { onDelete: "set null" }),
  mileage: integer("mileage"),
  hours: integer("hours"),
  cost: money("cost"),
  shop: text("shop"),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  tenantEquipmentFk("service_equipment_fk", t.fleetId, t.equipmentId),
  index("service_equipment_date").on(t.equipmentId, t.date),
  check("service_cost_nonneg", sql`coalesce(${t.cost}, 0) >= 0`),
]);

/** One stop, many product lines; the stop total is the sum of lines and is counted once. */
export const fuelStops = pgTable("fuel_stops", {
  id: id(),
  fleetId: uuid("fleet_id").notNull().references(() => fleets.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  station: text("station"),
  notes: text("notes"),
  total: money("total").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique("fuel_stops_fleet_id").on(t.fleetId, t.id),
  index("fuel_stops_fleet_date").on(t.fleetId, t.date),
]);

export const fuelLines = pgTable("fuel_lines", {
  id: id(),
  fleetId: uuid("fleet_id").notNull(),
  stopId: uuid("stop_id").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  product: fuelProduct("product").notNull(),
  gallons: numeric("gallons", { precision: 10, scale: 3, mode: "number" }),
  pricePerGallon: numeric("price_per_gallon", { precision: 8, scale: 3, mode: "number" }),
  subtotal: money("subtotal").notNull(),
  odometer: integer("odometer"),
  hours: integer("hours"),
}, (t) => [
  foreignKey({ name: "fuel_lines_stop_fk", columns: [t.fleetId, t.stopId], foreignColumns: [fuelStops.fleetId, fuelStops.id] }).onDelete("cascade"),
  tenantEquipmentFk("fuel_lines_equipment_fk", t.fleetId, t.equipmentId),
  unique("fuel_lines_stop_product").on(t.stopId, t.product),
  check("fuel_lines_nonneg", sql`${t.subtotal} >= 0 and coalesce(${t.gallons}, 0) >= 0 and coalesce(${t.pricePerGallon}, 0) >= 0`),
]);

export const diagnosticSessions = pgTable("diagnostic_sessions", {
  id: id(),
  fleetId: uuid("fleet_id").notNull(),
  equipmentId: uuid("equipment_id").notNull(),
  symptom: text("symptom").notNull(),
  status: diagnosticStatus("status").notNull().default("open"),
  resolutionNote: text("resolution_note"),
  serviceRecordId: uuid("service_record_id"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique("diagnostic_sessions_fleet_id").on(t.fleetId, t.id),
  tenantEquipmentFk("diagnostic_equipment_fk", t.fleetId, t.equipmentId),
  index("diagnostic_sessions_fleet").on(t.fleetId, t.createdAt),
]);

/** The model conversation, append-only so prompt caching and replay stay valid. */
export const diagnosticTurns = pgTable("diagnostic_turns", {
  id: id(),
  fleetId: uuid("fleet_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  seq: integer("seq").notNull(),
  role: diagnosticRole("role").notNull(),
  content: jsonb("content").notNull(),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ name: "diagnostic_turns_session_fk", columns: [t.fleetId, t.sessionId], foreignColumns: [diagnosticSessions.fleetId, diagnosticSessions.id] }).onDelete("cascade"),
  unique("diagnostic_turns_seq").on(t.sessionId, t.seq),
]);

export const diagnosticCauses = pgTable("diagnostic_causes", {
  id: id(),
  fleetId: uuid("fleet_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  rank: smallint("rank").notNull(),
  name: text("name").notNull(),
  likelihood: likelihood("likelihood").notNull(),
  why: text("why").notNull(),
  howToCheck: text("how_to_check").notNull(),
  costTier: costTier("cost_tier").notNull(),
  safetyCritical: boolean("safety_critical").notNull().default(false),
  needsShop: boolean("needs_shop").notNull().default(false),
  tried: boolean("tried").notNull().default(false),
  ruledOut: boolean("ruled_out").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ name: "diagnostic_causes_session_fk", columns: [t.fleetId, t.sessionId], foreignColumns: [diagnosticSessions.fleetId, diagnosticSessions.id] }).onDelete("cascade"),
  index("diagnostic_causes_session").on(t.sessionId, t.rank),
]);

/** Per-fleet daily AI request counter; the quota check and increment happen in one statement. */
export const aiUsage = pgTable("ai_usage", {
  fleetId: uuid("fleet_id").notNull().references(() => fleets.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  requests: integer("requests").notNull().default(0),
}, (t) => [unique("ai_usage_fleet_day").on(t.fleetId, t.day)]);

/**
 * Files in the private `attachments` bucket. The parent is polymorphic (diagnostic session, service
 * record, or fuel stop), so ownership is checked in code before upload; the key always starts with
 * fleets/<fleet_id>/ and is generated by the server.
 */
export const attachments = pgTable("attachments", {
  id: id(),
  fleetId: uuid("fleet_id").notNull().references(() => fleets.id, { onDelete: "cascade" }),
  kind: attachmentKind("kind").notNull(),
  parentId: uuid("parent_id").notNull(),
  storageKey: text("storage_key").notNull().unique("attachments_storage_key"),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("attachments_parent").on(t.fleetId, t.kind, t.parentId),
  check("attachments_size", sql`${t.byteSize} > 0 and ${t.byteSize} <= 3000000`),
]);
