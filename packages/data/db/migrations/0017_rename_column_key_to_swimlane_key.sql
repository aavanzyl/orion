DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'triggers' AND column_name = 'column_key'
  ) THEN
    ALTER TABLE "triggers" RENAME COLUMN "column_key" TO "swimlane_key";
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'column_key'
  ) THEN
    ALTER TABLE "tickets" RENAME COLUMN "column_key" TO "swimlane_key";
  END IF;
END $$;
