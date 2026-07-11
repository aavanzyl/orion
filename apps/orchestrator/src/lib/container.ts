import { BoardConnectionRepository, ChatRepository, createDb, type DbHandle, EvaluationRepository, EventRepository, LabelRepository, McpServerRepository, ProjectRepository, ProviderRepository, RagRepository, RunRepository, TicketRepository, ScheduleRepository, SettingsRepository } from '@orion/db';
import { HarnessRegistry } from '@orion/harness-core';
import { CodexHarness } from '@orion/harness-codex';
import { OpenAiHarness } from '@orion/harness-openai';
import { ClaudeHarness } from '@orion/harness-claude';
import { ScmRegistry } from '@orion/scm-core';
import { GitHubScmProvider } from '@orion/scm-github';
import { BoardRegistry } from '@orion/board-core';
import { NativeBoardProvider } from '@orion/board-native';
import { CommunicationRegistry } from '@orion/communication-core';
import { WebhookNotifier, SlackNotifier } from '@orion/communication-webhook';
import { BoardSyncService } from './services/board-sync.service.js';
import { RagService } from './services/rag.service.js';
import { SecretCipher } from './crypto.js';
import type { OrionEnv } from './env.js';
import { RunEventBus } from './event-bus.js';
import { ChatEventBus } from './chat-event-bus.js';

export interface Container {
  env: OrionEnv;
  dbHandle: DbHandle;
  projects: ProjectRepository;
  providers: ProviderRepository;
  tickets: TicketRepository;
  labels: LabelRepository;
  runs: RunRepository;
  events: EventRepository;
  evaluations: EvaluationRepository;
  chat: ChatRepository;
  schedules: ScheduleRepository;
  harnesses: HarnessRegistry;
  scm: ScmRegistry;
  boards: BoardRegistry;
  communication: CommunicationRegistry;
  bus: RunEventBus;
  chatBus: ChatEventBus;
  boardConnections: BoardConnectionRepository;
  boardSync: BoardSyncService;
  rag: RagRepository;
  ragService: RagService;
  mcpServers: McpServerRepository;
  settings: SettingsRepository;
  oauthStates: Map<string, { mcpServerId: string; expiresAt: number }>;
}

/** Compose all dependencies and register the in-scope adapter implementations. */
export function createContainer(env: OrionEnv): Container {
  const dbHandle = createDb(env.databaseUrl);
  const { db } = dbHandle;

  const projects = new ProjectRepository(db);
  const providers = new ProviderRepository(db);
  const tickets = new TicketRepository(db);
  const labels = new LabelRepository(db);
  const runs = new RunRepository(db);
  const events = new EventRepository(db);
  const evaluations = new EvaluationRepository(db);
  const chat = new ChatRepository(db);
  const schedules = new ScheduleRepository(db);
  const boardConnections = new BoardConnectionRepository(db);
  const rag = new RagRepository(db);
  const mcpServers = new McpServerRepository(db);
  const settings = new SettingsRepository(db);

  const harnesses = new HarnessRegistry()
    .register(new CodexHarness({ apiKey: env.codexApiKey, baseUrl: env.codexBaseUrl }))
    .register(new OpenAiHarness({ apiKey: env.codexApiKey, baseUrl: env.codexBaseUrl }))
    .register(new ClaudeHarness({ apiKey: env.claudeApiKey, baseUrl: env.claudeBaseUrl }));

  const scm = new ScmRegistry().register(new GitHubScmProvider({ token: env.githubToken }));

  const boards = new BoardRegistry().register(new NativeBoardProvider(tickets, labels));

  const communication = new CommunicationRegistry();
  if (env.notifyWebhookUrl) {
    communication.register(new WebhookNotifier({ url: env.notifyWebhookUrl }));
  }
  if (env.slackWebhookUrl) {
    communication.register(new SlackNotifier({ url: env.slackWebhookUrl }));
  }

  const container: Container = {
    env,
    dbHandle,
    projects,
    providers,
    tickets,
    labels,
    runs,
    events,
    evaluations,
    chat,
    schedules,
    harnesses,
    scm,
    boards,
    communication,
    bus: new RunEventBus(),
    chatBus: new ChatEventBus(),
    boardConnections,
    boardSync: new BoardSyncService(
      boardConnections,
      tickets,
      projects,
      boards,
      new SecretCipher(env.providerEncryptionSalt),
    ),
    rag,
    // Assigned below; RagService needs the assembled container.
    ragService: undefined as unknown as RagService,
    mcpServers,
    settings,
    oauthStates: new Map(),
  };

  container.ragService = new RagService(container);

  return container;
}
