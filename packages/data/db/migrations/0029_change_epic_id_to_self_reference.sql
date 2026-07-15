ALTER TABLE "tickets" DROP COLUMN "epic_id";
ALTER TABLE "tickets" ADD COLUMN "epic_id" uuid REFERENCES "tickets"("id") ON DELETE SET NULL;
