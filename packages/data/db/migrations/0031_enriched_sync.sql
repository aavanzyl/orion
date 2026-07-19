ALTER TABLE "board_connections" DROP COLUMN IF EXISTS "trigger_on_import";
--> statement-breakpoint
ALTER TABLE "epics" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_sync_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "imported" integer DEFAULT 0 NOT NULL,
  "updated" integer DEFAULT 0 NOT NULL,
  "epics_linked" integer DEFAULT 0 NOT NULL,
  "error" text,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "trigger" text DEFAULT 'manual' NOT NULL
);
