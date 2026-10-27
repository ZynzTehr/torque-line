CREATE TYPE "public"."platform_role" AS ENUM('super', 'support');--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "role" "platform_role" DEFAULT 'super' NOT NULL;