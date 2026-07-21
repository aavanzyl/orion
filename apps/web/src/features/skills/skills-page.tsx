import { SkillsSection } from '@/features/settings/skills-section';

export function SkillsPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <h1 className="text-lg font-semibold">Skills</h1>
        <p className="text-sm text-muted-foreground">
          Manage the skills available to agents. Skills are shared across all
          projects.
        </p>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-6xl flex flex-col gap-6">
          <SkillsSection global />
        </div>
      </main>
    </div>
  );
}
