import type { NodeExecutionContext, NodeOutcome } from '@orion/workflow-engine';
import type { ScmProvider } from '@orion/scm-core';
import type { TicketRepository } from '@orion/db';
import type { AgentTextGenerator } from '../agent-text.js';

/** Collaborators an SCM action needs, injected by the {@link ScmNodeExecutor}. */
export interface ScmActionDeps {
  scm: ScmProvider;
  tickets: TicketRepository;
  /** Generates agent-written content (e.g. PR titles/descriptions) on demand. */
  agentText: AgentTextGenerator;
}

/**
 * A single `scm` node action. Each canonical action name maps to one of these
 * in the registry. Actions receive the node execution context and the SCM
 * collaborators, and return a standard node outcome.
 */
export type ScmAction = (ctx: NodeExecutionContext, deps: ScmActionDeps) => Promise<NodeOutcome>;
