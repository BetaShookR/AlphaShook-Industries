CREATE TYPE "public"."release_status" AS ENUM('uploading', 'verifying', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "status" "release_status" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "launch_path" text;