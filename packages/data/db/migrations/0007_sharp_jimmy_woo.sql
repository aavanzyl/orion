CREATE TABLE "board_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text DEFAULT 'linear' NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"team_id" text DEFAULT '' NOT NULL,
	"state_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_connections_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "board_connections" ADD CONSTRAINT "board_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;