DROP INDEX "equipment_fleet_unit";--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_schedule_id_maintenance_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."maintenance_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_fleet_unit" ON "equipment" USING btree ("fleet_id","normalized_unit_number") WHERE "equipment"."archived_at" is null;