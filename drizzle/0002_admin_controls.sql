CREATE TYPE "public"."fleet_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "status" "fleet_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "status_note" text;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "status_changed_by" text;