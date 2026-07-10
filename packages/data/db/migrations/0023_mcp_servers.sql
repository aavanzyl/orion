CREATE TABLE IF NOT EXISTS "mcp_servers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "auth_type" text DEFAULT 'none' NOT NULL,
  "oauth" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_servers_name_unique" UNIQUE("name")
);
