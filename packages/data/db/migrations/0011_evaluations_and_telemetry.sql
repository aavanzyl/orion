CREATE TABLE "run_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" uuid,
	"rating" text DEFAULT 'neutral' NOT NULL,
	"score" double precision,
	"evaluator" text DEFAULT 'human' NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "attempts" integer;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "timed_out" boolean;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "run_nodes" ADD COLUMN "structured_output_valid" boolean;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "config_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "run_evaluations" ADD CONSTRAINT "run_evaluations_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evaluations" ADD CONSTRAINT "run_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evaluations" ADD CONSTRAINT "run_evaluations_node_id_run_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."run_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_evaluations_run_id_idx" ON "run_evaluations" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_evaluations_project_id_idx" ON "run_evaluations" USING btree ("project_id");