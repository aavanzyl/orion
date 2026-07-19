import { describe, expect, it } from 'vitest';
import {
  coerceNodeType,
  dataToNodeConfig,
  nodeConfigToData,
  validateNodeData,
} from './node-model';
import { remapIssueTypeWorkflows } from '../config/config-model';
import type { WorkflowNodeConfig, IssueTypeConfig } from '@orion/models';
import type { NodeData } from './node-model';

function roundTrip(cfg: WorkflowNodeConfig): WorkflowNodeConfig {
  const data = nodeConfigToData(cfg);
  return dataToNodeConfig(data, cfg.id, cfg.dependsOn ?? []);
}

describe('node-model round-trip', () => {
  it('plain agent node survives round-trip unchanged', () => {
    const cfg: WorkflowNodeConfig = {
      id: 'my-agent',
      type: 'agent',
      provider: 'codex',
      model: 'gpt-5-codex',
      instructions: 'instructions/my-agent.md',
    };
    expect(roundTrip(cfg)).toEqual(cfg);
  });

  it('plain shell node survives round-trip unchanged', () => {
    const cfg: WorkflowNodeConfig = {
      id: 'lint',
      type: 'shell',
      script: 'npm run lint',
    };
    expect(roundTrip(cfg)).toEqual(cfg);
  });

  it('message node with agentGenerated keeps provider and model', () => {
    const cfg: WorkflowNodeConfig = {
      id: 'msg-ai',
      type: 'message',
      messageTarget: 'notify',
      agentGenerated: true,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      message: 'Keep it short',
    };
    expect(roundTrip(cfg)).toEqual(cfg);
  });

  it('message node without agentGenerated does not leak model', () => {
    const cfg: WorkflowNodeConfig = {
      id: 'msg-static',
      type: 'message',
      messageTarget: 'notify',
      message: 'Deploy done',
      provider: 'slack',
      level: 'info',
    };
    expect(roundTrip(cfg)).toEqual(cfg);
  });

  it('scm open_pull_request with agentGenerated keeps provider and model', () => {
    const cfg: WorkflowNodeConfig = {
      id: 'pr-ai',
      type: 'scm',
      action: 'open_pull_request',
      agentGenerated: true,
      provider: 'codex',
      model: 'gpt-5-codex',
    };
    expect(roundTrip(cfg)).toEqual(cfg);
  });

  it('scm open_pull_request without agentGenerated does not leak provider/model', () => {
    const cfg: WorkflowNodeConfig = {
      id: 'pr-static',
      type: 'scm',
      action: 'open_pull_request',
      config: { title: 'My PR', body: 'Description' },
    };
    expect(roundTrip(cfg)).toEqual(cfg);
  });

  it('workflow node keeps workflow reference', () => {
    const cfg: WorkflowNodeConfig = {
      id: 'deploy-sub',
      type: 'workflow',
      workflow: 'deploy',
    } as WorkflowNodeConfig;
    expect(roundTrip(cfg)).toEqual(cfg);
  });

  it('coerceNodeType passes through workflow', () => {
    expect(coerceNodeType('workflow')).toBe('workflow');
  });

  it('coerceNodeType migrates legacy notify and comment to message', () => {
    expect(coerceNodeType('notify')).toBe('message');
    expect(coerceNodeType('comment')).toBe('message');
  });

  it('coerceNodeType defaults unknown types to agent', () => {
    expect(coerceNodeType('unknown')).toBe('agent');
  });

  it('validateNodeData does not reject valid workflow nodes', () => {
    const data: NodeData = { type: 'workflow', workflow: 'deploy' };
    expect(validateNodeData(data, 'wf-node')).toEqual([]);
  });

  it('validateNodeData allows workflow nodes without a workflow ref (warning-less)', () => {
    const data: NodeData = { type: 'workflow' };
    expect(validateNodeData(data, 'wf-blank')).toEqual([]);
  });

  it('validateNodeData still flags known type errors', () => {
    const data: NodeData = { type: 'agent' };
    expect(validateNodeData(data, 'a')).toContainEqual(
      expect.stringContaining('has no provider'),
    );
  });
});

describe('remapIssueTypeWorkflows', () => {
  it('returns undefined when input is undefined', () => {
    expect(remapIssueTypeWorkflows(undefined, 'default')).toBeUndefined();
  });

  it('returns undefined when input is empty array', () => {
    expect(remapIssueTypeWorkflows([], 'default')).toEqual([]);
  });

  it('remaps stale refs to the new workflow name', () => {
    const types: IssueTypeConfig[] = [
      { name: 'feature', label: 'Feature', workflow: 'investigate-only' },
      { name: 'bug', label: 'Bug', workflow: 'investigate-only' },
    ];
    const result = remapIssueTypeWorkflows(types, 'default');
    expect(result).toEqual([
      { name: 'feature', label: 'Feature', workflow: 'default' },
      { name: 'bug', label: 'Bug', workflow: 'default' },
    ]);
  });

  it('preserves refs that match the new workflow name', () => {
    const types: IssueTypeConfig[] = [
      { name: 'feature', label: 'Feature', workflow: 'default' },
      { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
    ];
    const result = remapIssueTypeWorkflows(types, 'default', { 'bug-fix': {} });
    expect(result).toBe(types);
  });

  it('preserves refs to still-existing workflows in the workflows map', () => {
    const types: IssueTypeConfig[] = [
      { name: 'feature', label: 'Feature', workflow: 'default' },
      { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
    ];
    const result = remapIssueTypeWorkflows(types, 'deploy', { 'bug-fix': {} });
    expect(result).toEqual([
      { name: 'feature', label: 'Feature', workflow: 'deploy' },
      { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
    ]);
  });

  it('remaps only stale refs, preserving valid ones', () => {
    const types: IssueTypeConfig[] = [
      { name: 'feature', label: 'Feature', workflow: 'stale' },
      { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
      { name: 'issue', label: 'Issue', workflow: 'default' },
    ];
    const result = remapIssueTypeWorkflows(types, 'default', { 'bug-fix': {} });
    expect(result).toEqual([
      { name: 'feature', label: 'Feature', workflow: 'default' },
      { name: 'bug', label: 'Bug', workflow: 'bug-fix' },
      { name: 'issue', label: 'Issue', workflow: 'default' },
    ]);
  });

  it('returns original array when nothing changes', () => {
    const types: IssueTypeConfig[] = [
      { name: 'feature', label: 'Feature', workflow: 'default' },
    ];
    const result = remapIssueTypeWorkflows(types, 'default');
    expect(result).toBe(types);
  });
});
