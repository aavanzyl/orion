import type { McpServerConfig } from '@orion/models';

export type McpAuthType = 'none' | 'api_key' | 'oauth' | 'bearer_token';

export interface McpCatalogEntry {
  /** Unique key used as the server name in the MCP map, e.g. "context7" */
  key: string;
  /** Human-readable title */
  title: string;
  /** One-sentence description of what the server provides */
  description: string;
  /** Category for grouping (e.g. "Code & Docs", "Data", "Browser", "Communication") */
  category: string;
  /** List of representative tool names this server exposes */
  tools: string[];
  /** List of representative resource names this server exposes */
  resources?: string[];
  /** List of representative prompt names this server exposes */
  prompts?: string[];
  /** How to configure this server */
  config: McpServerConfig;
  /** Optional note about required auth / setup */
  setupNote?: string;
  /** The type of authentication this server requires */
  authType: McpAuthType;
  /** URL where users can create/obtain the required credentials (API key, OAuth app, etc.) */
  authUrl?: string;
  /** Detailed OAuth / authentication setup steps for the user */
  oauthGuide?: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

/** Origin of the Orion orchestrator, derived from the configured API URL. */
function orionOrigin(): string {
  try {
    return new URL(API_URL).origin;
  } catch {
    return API_URL.replace(/\/api\/?$/, '');
  }
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    key: 'orion-codebase',
    title: 'Orion Codebase',
    description: "Semantic search over this project's indexed codebase (RAG).",
    category: 'Orion',
    tools: ['list_projects', 'search_code', 'index_status'],
    config: { url: `${orionOrigin()}/mcp/codebase` },
    authType: 'none',
    setupNote:
      'Built-in Orion server. The running agent is automatically bound to its own project.',
  },
  {
    key: 'orion-tickets',
    title: 'Orion Tickets',
    description: 'Read and manage the Orion board: tickets, swimlanes and labels.',
    category: 'Orion',
    tools: [
      'list_projects',
      'list_tickets',
      'get_ticket',
      'create_ticket',
      'update_ticket',
      'move_ticket',
      'list_labels',
    ],
    config: { url: `${orionOrigin()}/mcp/tickets` },
    authType: 'none',
    setupNote:
      'Built-in Orion server. The running agent is automatically bound to its own project.',
  },
  {
    key: 'context7',
    title: 'Context7',
    description: 'Up-to-date documentation and code examples for libraries and frameworks.',
    category: 'Code & Docs',
    tools: ['resolve-library-id', 'get-library-docs'],
    config: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    authType: 'none',
  },
  {
    key: 'github',
    title: 'GitHub Copilot',
    description: 'GitHub API integration: repos, issues, PRs, search, and more.',
    category: 'Code & Docs',
    tools: ['search_repositories', 'get_file_contents', 'create_issue', 'list_pull_requests'],
    config: {
      url: 'https://api.githubcopilot.com/mcp/',
      bearerToken: '${GITHUB_TOKEN}',
    },
    authType: 'bearer_token',
    authUrl: 'https://github.com/settings/tokens',
    oauthGuide:
      'Create a GitHub personal access token with repo scope:\n' +
      '1. Go to Settings → Developer settings → Personal access tokens → Tokens (classic).\n' +
      '2. Click "Generate new token (classic)".\n' +
      '3. Select the "repo" scope (and "read:org" if needed).\n' +
      '4. Copy the token and set it as the GITHUB_TOKEN environment variable.',
  },
  {
    key: 'brave-search',
    title: 'Brave Search',
    description: 'Web search via Brave Search API for current information.',
    category: 'Web & Browser',
    tools: ['brave_web_search', 'brave_local_search'],
    config: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-brave-search'],
      env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
    },
    authType: 'api_key',
    authUrl: 'https://brave.com/search/api/',
    oauthGuide:
      'Get a free Brave Search API key:\n' +
      '1. Visit https://brave.com/search/api/ and sign up.\n' +
      '2. Choose a plan (Free includes 2,000 queries/month).\n' +
      '3. Copy your API key and set it as the BRAVE_API_KEY environment variable.',
  },
  {
    key: 'puppeteer',
    title: 'Puppeteer (Browserbase)',
    description: 'Headless Chrome browser for web scraping, screenshots, and browser automation.',
    category: 'Web & Browser',
    tools: ['puppeteer_navigate', 'puppeteer_screenshot', 'puppeteer_click', 'puppeteer_fill', 'puppeteer_select', 'puppeteer_hover', 'puppeteer_evaluate', 'puppeteer_close'],
    config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-puppeteer'] },
    authType: 'none',
    setupNote: 'No auth required. Browser automation runs locally.',
  },
  {
    key: 'fetch',
    title: 'HTTP Fetch',
    description: 'Make HTTP requests to fetch web pages and API responses.',
    category: 'Web & Browser',
    tools: ['fetch', 'fetch_html'],
    config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-fetch'] },
    authType: 'none',
  },
  {
    key: 'linear',
    title: 'Linear',
    description: 'Read and manage Linear issues, projects, cycles, and teams.',
    category: 'Project Management',
    tools: ['list_issues', 'create_issue', 'update_issue', 'search_issues', 'list_projects'],
    config: {
      url: 'https://mcp.linear.app/sse',
      bearerToken: '${LINEAR_API_KEY}',
    },
    authType: 'api_key',
    authUrl: 'https://linear.app/settings/api',
    oauthGuide:
      'Create a Linear personal API key:\n' +
      '1. Go to Linear → Settings → API → Personal API keys.\n' +
      '2. Click "Create new API key" and give it a label (e.g. "Orion MCP").\n' +
      '3. Copy the key and set it as the LINEAR_API_KEY environment variable.',
  },
  {
    key: 'postgres',
    title: 'PostgreSQL',
    description: 'Direct SQL query access to a PostgreSQL database.',
    category: 'Data',
    tools: ['list_databases', 'query', 'describe_table'],
    config: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-postgres'],
      env: { DATABASE_URL: '${DATABASE_URL}' },
    },
    authType: 'none',
    setupNote: 'Requires a PostgreSQL connection string in the DATABASE_URL environment variable.',
  },
  {
    key: 'supabase',
    title: 'Supabase',
    description: 'Supabase management: tables, auth, edge functions, storage.',
    category: 'Data',
    tools: ['list_tables', 'query_table', 'manage_auth', 'deploy_function'],
    config: {
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase'],
      env: { SUPABASE_ACCESS_TOKEN: '${SUPABASE_ACCESS_TOKEN}' },
    },
    authType: 'api_key',
    authUrl: 'https://supabase.com/dashboard/account/tokens',
    oauthGuide:
      'Get a Supabase personal access token:\n' +
      '1. Go to Supabase Dashboard → Account → Access Tokens.\n' +
      '2. Click "Generate new token" and give it a name.\n' +
      '3. Copy the token and set it as the SUPABASE_ACCESS_TOKEN environment variable.',
  },
  {
    key: 'filesystem',
    title: 'File System',
    description: 'Read, write, search and manage files on the local filesystem.',
    category: 'System',
    tools: ['read_file', 'write_file', 'list_directory', 'search_files', 'get_file_info'],
    config: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-filesystem', '/path/to/allowed/dir'],
    },
    authType: 'none',
    setupNote: 'Provide an allowed directory as the final argument. Restricts access for security.',
  },
  {
    key: 'memory',
    title: 'Memory (Knowledge Graph)',
    description: 'Persistent memory and knowledge graph for agents across sessions.',
    category: 'System',
    tools: ['create_entities', 'create_relations', 'search_nodes', 'open_nodes'],
    config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-memory'] },
    authType: 'none',
  },
  {
    key: 'sequential-thinking',
    title: 'Sequential Thinking',
    description: 'Multi-step reasoning and thought chaining for complex problems.',
    category: 'Reasoning',
    tools: ['sequentialthinking'],
    config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-sequential-thinking'] },
    authType: 'none',
  },
  {
    key: 'git',
    title: 'Git MCP',
    description: 'Git operations: status, log, diff, branch, commit, push.',
    category: 'Code & Docs',
    tools: ['git_status', 'git_log', 'git_diff', 'git_branch', 'git_commit', 'git_push', 'git_checkout'],
    config: { command: 'npx', args: ['-y', 'git-mcp'] },
    authType: 'none',
    setupNote: 'No auth required. Runs against the local git repository.',
  },
  {
    key: 'docker',
    title: 'Docker',
    description: 'Manage Docker containers, images, volumes and networks.',
    category: 'System',
    tools: ['list_containers', 'create_container', 'start_container', 'stop_container', 'execute_command', 'list_images'],
    config: { command: 'npx', args: ['-y', '@anthropic/mcp-server-docker'] },
    authType: 'none',
  },
  {
    key: 'sentry',
    title: 'Sentry',
    description: 'Access Sentry error tracking: issues, events, projects.',
    category: 'Monitoring',
    tools: ['list_issues', 'get_issue', 'list_projects'],
    config: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-sentry'],
      env: { SENTRY_AUTH_TOKEN: '${SENTRY_AUTH_TOKEN}' },
    },
    authType: 'api_key',
    authUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    oauthGuide:
      'Create a Sentry auth token:\n' +
      '1. Go to Sentry → Settings → Account → API → Auth Tokens.\n' +
      '2. Click "Create New Token" and select "project:read" scope.\n' +
      '3. Copy the token and set it as the SENTRY_AUTH_TOKEN environment variable.',
  },
  {
    key: 'slack',
    title: 'Slack',
    description: 'Send messages, list channels, and search conversations in Slack.',
    category: 'Communication',
    tools: ['list_channels', 'post_message', 'search_messages', 'get_channel_history'],
    config: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-slack'],
      env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}' },
    },
    authType: 'oauth',
    authUrl: 'https://api.slack.com/apps',
    oauthGuide:
      'Create a Slack bot token via OAuth:\n' +
      '1. Go to https://api.slack.com/apps and click "Create New App" → "From scratch".\n' +
      '2. Under "OAuth & Permissions", add Bot Token scopes: channels:read, chat:write, search:read.\n' +
      '3. Click "Install to Workspace" and authorize.\n' +
      '4. Copy the Bot User OAuth Token and set it as the SLACK_BOT_TOKEN environment variable.',
  },
  {
    key: 'notion',
    title: 'Notion',
    description: 'Read, create, and update Notion pages and databases.',
    category: 'Communication',
    tools: ['search_pages', 'get_page', 'create_page', 'update_page', 'query_database'],
    config: {
      command: 'npx',
      args: ['-y', '@anthropic/mcp-server-notion'],
      env: { NOTION_API_TOKEN: '${NOTION_API_TOKEN}' },
    },
    authType: 'oauth',
    authUrl: 'https://www.notion.so/my-integrations',
    oauthGuide:
      'Create a Notion integration (OAuth):\n' +
      '1. Go to https://www.notion.so/my-integrations and click "New integration".\n' +
      '2. Name it, select the workspace, and configure capabilities.\n' +
      '3. Copy the "Internal Integration Secret" token.\n' +
      '4. Set it as the NOTION_API_TOKEN environment variable.\n' +
      '5. Share the target pages/databases with your integration via the "Connections" menu.',
  },
  {
    key: 'aws-docs',
    title: 'AWS Docs',
    description: 'Search and read the latest AWS documentation and API references.',
    category: 'Code & Docs',
    tools: ['read_documentation', 'search_documentation', 'recommend'],
    config: {
      command: 'uvx',
      args: ['awslabs.aws-documentation-mcp-server@latest'],
    },
    authType: 'none',
  },
];

/** Lookup a catalog entry by its key. */
export function getCatalogEntry(key: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((e) => e.key === key);
}

/** Group catalog entries by category. */
export function getCatalogByCategory(): Map<string, McpCatalogEntry[]> {
  const map = new Map<string, McpCatalogEntry[]>();
  for (const entry of MCP_CATALOG) {
    const list = map.get(entry.category) ?? [];
    list.push(entry);
    map.set(entry.category, list);
  }
  return map;
}
