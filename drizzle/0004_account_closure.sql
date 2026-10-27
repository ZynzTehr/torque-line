CREATE TYPE "public"."account_state" AS ENUM('closed', 'deletion_scheduled');--> statement-breakpoint
CREATE TABLE "account_states" (
	"user_id" text PRIMARY KEY NOT NULL,
	"state" "account_state" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone,
	CONSTRAINT "account_states_purge_after" CHECK (("account_states"."state" = 'deletion_scheduled') = ("account_states"."purge_after" is not null))
);
--> statement-breakpoint
CREATE TABLE "anon_diagnostic_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_ref" uuid NOT NULL,
	"session_ref" uuid NOT NULL,
	"equipment_type" "equipment_type" NOT NULL,
	"year" smallint,
	"make" text,
	"model" text,
	"cause_name" text NOT NULL,
	"likelihood" "likelihood" NOT NULL,
	"tried" boolean NOT NULL,
	"ruled_out" boolean NOT NULL,
	"resolved" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anon_fuel_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_ref" uuid NOT NULL,
	"equipment_type" "equipment_type" NOT NULL,
	"year" smallint,
	"make" text,
	"model" text,
	"product" "fuel_product" NOT NULL,
	"gallons" numeric(10, 3),
	"price_per_gallon" numeric(8, 3),
	"month" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anon_meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_ref" uuid NOT NULL,
	"kind" "meter_kind" NOT NULL,
	"month" date NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anon_service_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_ref" uuid NOT NULL,
	"equipment_type" "equipment_type" NOT NULL,
	"year" smallint,
	"make" text,
	"model" text,
	"engine_size" text,
	"service_type" text NOT NULL,
	"mileage" integer,
	"hours" integer,
	"cost" numeric(12, 2),
	"month" date NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_states_due" ON "account_states" USING btree ("purge_after");--> statement-breakpoint
COMMENT ON TABLE "account_states" IS 'Accounts their owner closed or scheduled for deletion. No row means the account is open.';--> statement-breakpoint
COMMENT ON TABLE "anon_service_events" IS 'Anonymized service history copied from purged accounts. Contains no personal data; unit_ref is random with no mapping kept.';--> statement-breakpoint
COMMENT ON TABLE "anon_fuel_lines" IS 'Anonymized fuel purchases copied from purged accounts. Contains no personal data; unit_ref is random with no mapping kept.';--> statement-breakpoint
COMMENT ON TABLE "anon_meter_readings" IS 'Anonymized monthly meter readings copied from purged accounts. Contains no personal data; unit_ref is random with no mapping kept.';--> statement-breakpoint
COMMENT ON TABLE "anon_diagnostic_outcomes" IS 'Anonymized diagnosis outcomes copied from purged accounts. Contains no personal data; unit_ref and session_ref are random with no mapping kept.';
