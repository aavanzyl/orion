ALTER TABLE "workflow_runs" ADD COLUMN "diff" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "artifacts" jsonb;