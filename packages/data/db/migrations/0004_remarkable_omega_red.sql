ALTER TABLE "run_nodes" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "cached_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "total_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "cost_usd" double precision DEFAULT 0;