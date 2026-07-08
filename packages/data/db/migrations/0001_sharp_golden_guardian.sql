ALTER TABLE "projects" ALTER COLUMN "repo_url" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_kind" text DEFAULT 'remote' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "root_path" text;