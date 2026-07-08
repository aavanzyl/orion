import { BoardConnectionRepository, ChatRepository, createDb, type DbHandle, EvaluationRepository, EventRepository, LabelRepository, ProjectRepository, ProviderRepository, RagRepository, RunRepository, TicketRepository, TriggerRepository } from '@orion/db';
import { HarnessRegistry } from '@orion/harness-core';
import { CodexHarness } from '@orion/harness-codex';
import { ScmRegistry } from '@orion/scm-core';
import { GitHubScmProvider } from '@orion/scm-github';
import { BoardRegistry } from '@orion/board-core';
import { NativeBoardProvider } from '@orion/board-native';
import { CommunicationRegistry } from '@orion/communication-core';
import { WebhookNotifier, SlackNotifier } from '@orion/communication-webhook';
import { LinearSyncService } from './services/linear-sync.service.js';
import { RagService } from './services/rag.service.js';
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
  triggers: TriggerRepository;
  harnesses: HarnessRegistry;
  scm: ScmRegistry;
  boards: BoardRegistry;
  communication: CommunicationRegistry;
  bus: RunEventBus;
  chatBus: ChatEventBus;
  boardConnections: BoardConnectionRepository;
  linearSync: LinearSyncService;
  rag: RagRepository;
  ragService: RagService;
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
  const triggers = new TriggerRepository(db);
  const boardConnections = new BoardConnectionRepository(db);
  const rag = new RagRepository(db);

  const harnesses = new HarnessRegistry().register(
    new CodexHarness({ apiKey: env.codexApiKey, baseUrl: env.codexBaseUrl }),
  );

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
    triggers,
    harnesses,
    scm,
    boards,
    communication,
    bus: new RunEventBus(),
    chatBus: new ChatEventBus(),
    boardConnections,
    linearSync: new LinearSyncService(boardConnections, tickets, projects, boards),
    rag,
    // Assigned below; RagService needs the assembled container.
    ragService: undefined as unknown as RagService,
  };

  container.ragService = new RagService(container);

  return container;
}
