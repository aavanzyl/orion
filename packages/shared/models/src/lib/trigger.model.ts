import type { ProjectId } from './project.model.js';

export type TriggerId = string;

/**
 * How a trigger fires:
 * - `cron`    — on a recurring cron schedule.
 * - `webhook` — when an authenticated HTTP POST hits its endpoint.
 */
export type TriggerType = 'cron' | 'webhook';

/**
 * What a trigger does when it fires:
 * - `workflow` — create a ticket and start a run of the project's workflow
 *   (the classic board-driven behaviour).
 * - `agent`    — run a single, one-off agent turn with a custom prompt in the
 *   project workspace. Nothing is placed on the board unless the agent itself
 *   creates a ticket (e.g. via the Tickets MCP tool). Useful for scheduled
 *   maintenance like a daily check that files a ticket only when needed.
 */
export type TriggerAction = 'workflow' | 'agent';

/**
 * An automation that fires on a schedule or inbound webhook. Depending on its
 * {@link TriggerAction} it either creates a ticket and starts a workflow run, or
 * runs a standalone agent turn. Triggers are operational config stored in the
 * database (not in `.orion/config.yaml`).
 */
export interface Trigger {
  id: TriggerId;
  projectId: ProjectId;
  name: string;
  type: TriggerType;
  enabled: boolean;
  /** What the trigger does when it fires. Defaults to `workflow`. */
  action: TriggerAction;
  /** Cron expression (required for `cron` triggers). */
  cron?: string;
  /** Secret token used to authenticate the webhook endpoint (`webhook` only). */
  webhookToken?: string;
  /** Title for tickets created by this trigger (falls back to `name`). */
  ticketTitle?: string;
  /** Description for tickets created by this trigger. */
  ticketDescription?: string;
  /** Board swimlane new tickets land in (falls back to the first board swimlane). */
  swimlane?: string;
  /** Id of the configured agent to run (required for `agent` triggers). */
  agentId?: string;
  /** Prompt/instruction for the agent turn (`agent` triggers). */
  prompt?: string;
  /** When the trigger last fired, if ever. */
  lastFiredAt?: string;
  /** When a `cron` trigger will next fire. */
  nextFireAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTriggerInput {
  projectId: ProjectId;
  name: string;
  type: TriggerType;
  enabled?: boolean;
  /** Defaults to `workflow` when omitted. */
  action?: TriggerAction;
  cron?: string;
  ticketTitle?: string;
  ticketDescription?: string;
  swimlane?: string;
  agentId?: string;
  prompt?: string;
}

/** Mutable fields of a trigger. All optional — only provided fields change. */
export interface UpdateTriggerInput {
  name?: string;
  enabled?: boolean;
  action?: TriggerAction;
  cron?: string;
  ticketTitle?: string;
  ticketDescription?: string;
  swimlane?: string;
  agentId?: string;
  prompt?: string;
}
