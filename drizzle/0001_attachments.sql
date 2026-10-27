CREATE TYPE "public"."attachment_kind" AS ENUM('diagnostic_photo', 'service_receipt', 'fuel_receipt');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"parent_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key" UNIQUE("storage_key"),
	CONSTRAINT "attachments_size" CHECK ("attachments"."byte_size" > 0 and "attachments"."byte_size" <= 3000000)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_parent" ON "attachments" USING btree ("fleet_id","kind","parent_id");