ALTER TABLE "board_connections" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "board_connections" ADD COLUMN "direction" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "board_connections" ADD COLUMN "auto_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "board_connections" ADD COLUMN "import_new" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "board_connections" ADD COLUMN "update_existing" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "board_connections" ADD COLUMN "sync_interval_ms" integer;
