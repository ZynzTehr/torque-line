CREATE TYPE "public"."cost_tier" AS ENUM('free', 'low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."diagnostic_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."diagnostic_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."equipment_type" AS ENUM('tractor', 'trailer', 'reefer');--> statement-breakpoint
CREATE TYPE "public"."fuel_product" AS ENUM('diesel', 'def', 'reefer');--> statement-breakpoint
CREATE TYPE "public"."interval_source" AS ENUM('manual', 'template', 'ai_accepted');--> statement-breakpoint
CREATE TYPE "public"."likelihood" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner');--> statement-breakpoint
CREATE TYPE "public"."meter_kind" AS ENUM('odometer', 'hours');--> statement-breakpoint
CREATE TYPE "public"."pm_category" AS ENUM('PM-A', 'PM-B', 'PM-C', 'Annual');--> statement-breakpoint
CREATE TYPE "public"."reading_source" AS ENUM('manual', 'photo', 'service', 'fuel');--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"fleet_id" uuid NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_fleet_day" UNIQUE("fleet_id","day")
);
--> statement-breakpoint
CREATE TABLE "diagnostic_causes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"rank" smallint NOT NULL,
	"name" text NOT NULL,
	"likelihood" "likelihood" NOT NULL,
	"why" text NOT NULL,
	"how_to_check" text NOT NULL,
	"cost_tier" "cost_tier" NOT NULL,
	"safety_critical" boolean DEFAULT false NOT NULL,
	"needs_shop" boolean DEFAULT false NOT NULL,
	"tried" boolean DEFAULT false NOT NULL,
	"ruled_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"symptom" text NOT NULL,
	"status" "diagnostic_status" DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"service_record_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_sessions_fleet_id" UNIQUE("fleet_id","id")
);
--> statement-breakpoint
CREATE TABLE "diagnostic_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "diagnostic_role" NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_turns_seq" UNIQUE("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"normalized_unit_number" text NOT NULL,
	"type" "equipment_type" NOT NULL,
	"year" text,
	"make" text,
	"model" text,
	"engine_size" text,
	"vin" text,
	"current_mileage" integer,
	"current_hours" integer,
	"reading_updated_at" timestamp with time zone,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_fleet_id" UNIQUE("fleet_id","id"),
	CONSTRAINT "equipment_readings_nonneg" CHECK (coalesce("equipment"."current_mileage", 0) >= 0 and coalesce("equipment"."current_hours", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"ai_daily_limit" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"product" "fuel_product" NOT NULL,
	"gallons" numeric(10, 3),
	"price_per_gallon" numeric(8, 3),
	"subtotal" numeric(12, 2) NOT NULL,
	"odometer" integer,
	"hours" integer,
	CONSTRAINT "fuel_lines_stop_product" UNIQUE("stop_id","product"),
	CONSTRAINT "fuel_lines_nonneg" CHECK ("fuel_lines"."subtotal" >= 0 and coalesce("fuel_lines"."gallons", 0) >= 0 and coalesce("fuel_lines"."price_per_gallon", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "fuel_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"date" date NOT NULL,
	"station" text,
	"notes" text,
	"total" numeric(12, 2) NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_stops_fleet_id" UNIQUE("fleet_id","id")
);
--> statement-breakpoint
CREATE TABLE "maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "pm_category" NOT NULL,
	"description" text,
	"mileage_interval" integer,
	"time_interval_days" integer,
	"last_service_mileage" integer,
	"last_service_date" date,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" interval_source DEFAULT 'manual' NOT NULL,
	"source_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_has_trigger" CHECK ("maintenance_schedules"."mileage_interval" is not null or "maintenance_schedules"."time_interval_days" is not null),
	CONSTRAINT "schedules_positive" CHECK (coalesce("maintenance_schedules"."mileage_interval", 1) > 0 and coalesce("maintenance_schedules"."time_interval_days", 1) > 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_fleet_user" UNIQUE("fleet_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"kind" "meter_kind" NOT NULL,
	"value" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" "reading_source" DEFAULT 'manual' NOT NULL,
	"confirmed_lower" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readings_value_nonneg" CHECK ("readings"."value" >= 0),
	CONSTRAINT "readings_lower_has_note" CHECK (not "readings"."confirmed_lower" or length(coalesce("readings"."note", '')) > 0)
);
--> statement-breakpoint
CREATE TABLE "service_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"date" date NOT NULL,
	"service_type" text NOT NULL,
	"mileage" integer,
	"hours" integer,
	"cost" numeric(12, 2),
	"shop" text,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_cost_nonneg" CHECK (coalesce("service_records"."cost", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_causes" ADD CONSTRAINT "diagnostic_causes_session_fk" FOREIGN KEY ("fleet_id","session_id") REFERENCES "public"."diagnostic_sessions"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_equipment_fk" FOREIGN KEY ("fleet_id","equipment_id") REFERENCES "public"."equipment"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_turns" ADD CONSTRAINT "diagnostic_turns_session_fk" FOREIGN KEY ("fleet_id","session_id") REFERENCES "public"."diagnostic_sessions"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_lines" ADD CONSTRAINT "fuel_lines_stop_fk" FOREIGN KEY ("fleet_id","stop_id") REFERENCES "public"."fuel_stops"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_lines" ADD CONSTRAINT "fuel_lines_equipment_fk" FOREIGN KEY ("fleet_id","equipment_id") REFERENCES "public"."equipment"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_stops" ADD CONSTRAINT "fuel_stops_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "schedules_equipment_fk" FOREIGN KEY ("fleet_id","equipment_id") REFERENCES "public"."equipment"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_equipment_fk" FOREIGN KEY ("fleet_id","equipment_id") REFERENCES "public"."equipment"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_equipment_fk" FOREIGN KEY ("fleet_id","equipment_id") REFERENCES "public"."equipment"("fleet_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostic_causes_session" ON "diagnostic_causes" USING btree ("session_id","rank");--> statement-breakpoint
CREATE INDEX "diagnostic_sessions_fleet" ON "diagnostic_sessions" USING btree ("fleet_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_fleet_unit" ON "equipment" USING btree ("fleet_id","normalized_unit_number");--> statement-breakpoint
CREATE INDEX "fuel_stops_fleet_date" ON "fuel_stops" USING btree ("fleet_id","date");--> statement-breakpoint
CREATE INDEX "schedules_equipment" ON "maintenance_schedules" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "memberships_user" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "readings_equipment_observed" ON "readings" USING btree ("equipment_id","observed_at");--> statement-breakpoint
CREATE INDEX "service_equipment_date" ON "service_records" USING btree ("equipment_id","date");