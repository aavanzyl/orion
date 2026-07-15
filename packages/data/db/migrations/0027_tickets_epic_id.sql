ALTER TABLE "tickets" ADD COLUMN "epic_id" uuid REFERENCES "epics"("id") ON DELETE SET NULL;
