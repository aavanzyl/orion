ALTER TABLE "tickets" ADD COLUMN "type" text NOT NULL DEFAULT 'feature', ADD COLUMN "start_date" timestamp with time zone;
