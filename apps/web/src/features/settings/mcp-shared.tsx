import { useState } from 'react';
import { CheckIcon, CopyIcon, WrenchIcon } from 'lucide-react';
import type { McpServerConfig } from '@orion/models';
import { copyToClipboard } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

export const GLOBAL_MCP_STORAGE_KEY = 'orion_global_mcp_servers';

/** @deprecated Global MCP servers are now persisted via the DB API. Returns an empty object. */
export function readGlobalMcpServers(): Record<string, McpServerConfig> {
  return {};
}

export function serverOrigin(): string {
  try {
    return new URL(API_URL).origin;
  } catch {
    return API_URL.replace(/\/api\/?$/, '');
  }
}

export interface BuiltinServer {
  key: string;
  title: string;
  description: string;
  path: string;
  tools: string[];
  /** Map of tool name to its description. */
  toolDescriptions?: Record<string, string>;
  resources: string[];
  prompts: string[];
}

export const BUILTIN_SERVERS: BuiltinServer[] = [
  {
    key: 'orion-codebase',
    title: 'Codebase',
    description: 'Semantic search over an indexed project codebase (RAG).',
    path: '/mcp/codebase',
    tools: ['list_projects', 'search_code', 'index_status'],
    toolDescriptions: {
      list_projects: 'List the projects Orion manages so you can pick one to search.',
      search_code: 'Semantic search over a codebase index; returns the most relevant file chunks.',
      index_status: 'Report the status of a codebase index (provider, counts, freshness).',
    },
    resources: [],
    prompts: [],
  },
  {
    key: 'orion-tickets',
    title: 'Tickets',
    description: 'Full CRUD for tickets, epics, labels, relations, and board discovery.',
    path: '/mcp/tickets',
    tools: [
      'list_projects',
      'list_swimlanes',
      'list_tickets',
      'search_tickets',
      'get_ticket',
      'create_ticket',
      'update_ticket',
      'move_ticket',
      'manage_labels',
      'add_comment',
      'list_comments',
    ],
    toolDescriptions: {
      list_projects: 'List the projects Orion manages so you can pick one to work on.',
      list_swimlanes: 'Get the available swimlane keys and ticket types for a project.',
      list_tickets: 'List tickets with optional filters (swimlane, type, priority, epic). Set type to "epic" to list epics.',
      search_tickets: 'Semantic search over tickets; returns the most relevant tickets for a query.',
      get_ticket: 'Fetch a ticket with its labels, parent, sub-tickets and relations.',
      create_ticket: 'Create a ticket with optional type, epic, dates, labels, relations, and workflow binding. Set type to "epic" for epics.',
      update_ticket: 'Update ticket fields including move (swimlane/order), relations, and labels. Pass null to clear parent, agent, dates, or epic. Works on epics too.',
      delete_ticket: 'Permanently delete a ticket or epic.',
      manage_labels: 'Manage labels: list all, create a new label, or delete by id.',
      add_comment: 'Add a comment to a ticket, optionally with base64-encoded image attachments.',
      list_comments: 'List all comments on a ticket, including any image attachments.',
    },
    resources: [],
    prompts: [],
  },
];

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyToClipboard(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy">
      {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
    </Button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-md border bg-muted/50">
      <div className="absolute right-1.5 top-1.5">
        <CopyButton value={code} />
      </div>
      <pre className="overflow-auto p-3 pr-10 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

export function McpClientConnectCard() {
  const origin = serverOrigin();
  const clientConfig = JSON.stringify(
    {
      mcpServers: Object.fromEntries(
        BUILTIN_SERVERS.map((s) => [
          s.key,
          { url: `${origin}${s.path}` },
        ]),
      ),
    },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Connect an external MCP client</CardTitle>
          <CardDescription>
            Point any MCP-capable client (Claude Desktop, Cursor, another agent) at the built-in
            servers. The agent selects the project at call time via <code>list_projects</code> — no
            hardcoded project id needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock code={clientConfig} />
        </CardContent>
      </Card>

      {BUILTIN_SERVERS.map((server) => (
        <Card key={server.key}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <WrenchIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">
                {server.key} <span className="text-muted-foreground font-normal">— {server.title}</span>
              </CardTitle>
            </div>
            <CardDescription>{server.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {server.tools.length} tools
            </p>
            <ul className="space-y-1.5">
              {server.tools.map((tool) => (
                <li key={tool} className="text-sm">
                  <code className="rounded bg-muted px-1 py-0.5 text-xs font-semibold">{tool}</code>
                  {server.toolDescriptions?.[tool] && (
                    <span className="ml-2 text-muted-foreground">
                      {server.toolDescriptions[tool]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
