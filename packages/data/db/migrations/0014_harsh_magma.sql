ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "display_key" text;
