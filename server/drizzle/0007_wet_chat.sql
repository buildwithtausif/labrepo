ALTER TABLE "messages" ADD COLUMN "max_views" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;