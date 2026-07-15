CREATE TABLE IF NOT EXISTS "epics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "color" text DEFAULT '#7c3aed' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
