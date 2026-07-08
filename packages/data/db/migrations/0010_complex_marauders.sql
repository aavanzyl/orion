ALTER TABLE "triggers" ADD COLUMN "action" text DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "prompt" text;