ALTER TABLE "messages" ADD COLUMN "visible_to_sender" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "visible_to_receiver" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "expires_at" text;