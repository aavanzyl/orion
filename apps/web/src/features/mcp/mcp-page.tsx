import { McpSection } from '@/features/settings/mcp-section';

export function McpPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-6 py-4">
        <h1 className="text-lg font-semibold">MCP</h1>
        <p className="text-sm text-muted-foreground">
          Manage the MCP servers available to agents. MCP servers are shared
          across all projects.
        </p>
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-6xl flex flex-col gap-6">
          <McpSection global />
        </div>
      </main>
    </div>
  );
}
