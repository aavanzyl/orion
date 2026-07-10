import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
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
    resources: [],
    prompts: [],
  },
  {
    key: 'orion-tickets',
    title: 'Tickets',
    description: 'Read and manage the Orion board: tickets, swimlanes and labels.',
    path: '/mcp/tickets',
    tools: [
      'list_projects',
      'list_tickets',
      'get_ticket',
      'create_ticket',
      'update_ticket',
      'move_ticket',
      'list_labels',
    ],
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
  );
}
