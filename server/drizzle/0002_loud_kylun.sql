CREATE TABLE "announcements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "announcements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"message" text NOT NULL,
	"url" text,
	"url_label" text,
	"type" text DEFAULT 'info' NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"starts_at" text,
	"expires_at" text,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "announcements_type_check" CHECK ("announcements"."type" IN ('info', 'success', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE INDEX "idx_announcements_active" ON "announcements" USING btree ("is_active");