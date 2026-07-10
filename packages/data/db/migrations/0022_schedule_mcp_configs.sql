ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "mcp_server_configs" jsonb DEFAULT '{}'::jsonb NOT NULL;
