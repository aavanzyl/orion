import { describe, it, expect } from 'vitest';
import type { ProjectConfig } from '@orion/models';
import { parseProjectConfig } from './load-config.js';
import { serializeProjectConfig } from './save-config.js';
import { assertValidConfig } from './validate.js';
import {
  DEFAULT_WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  listWorkflowTemplates,
  renderWorkflowTemplateYaml,
  toWorkflowTemplateSummary,
  type WorkflowTemplate,
} from './default-workflows.js';

/** Compose a full ProjectConfig around a template so it can be validated. */
function toProjectConfig(template: WorkflowTemplate): ProjectConfig {
  return {
    project: { name: 'demo', defaultBranch: 'main' },
    board: { swimlanes: template.suggestedSwimlanes ?? ['backlog'] },
    workflow: template.workflow,
  };
}

describe('default workflow templates', () => {
  it('ships at least ten templates', () => {
    expect(listWorkflowTemplates().length).toBeGreaterThanOrEqual(10);
  });

  it('has unique, kebab-case template names', () => {
    const names = DEFAULT_WORKFLOW_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it.each(DEFAULT_WORKFLOW_TEMPLATES.map((t) => [t.name, t] as const))(
    'template "%s" validates as a full ProjectConfig',
    (_name, template) => {
      const config = toProjectConfig(template);
      expect(() => assertValidConfig(config)).not.toThrow();
      expect(() => parseProjectConfig(serializeProjectConfig(config))).not.toThrow();
    },
  );

  it.each(DEFAULT_WORKFLOW_TEMPLATES.map((t) => [t.name, t] as const))(
    'template "%s" only references its suggested swimlanes',
    (_name, template) => {
      const swimlanes = new Set(template.suggestedSwimlanes ?? []);
      for (const node of template.workflow.nodes) {
        if (node.swimlane) expect(swimlanes.has(node.swimlane)).toBe(true);
      }
    },
  );

  it('exposes loop nodes in the iterative templates', () => {
    const plan = getWorkflowTemplate('plan-implement-verify');
    const tdd = getWorkflowTemplate('tdd');
    expect(plan?.workflow.nodes.some((n) => n.loop?.until === 'ALL_TASKS_COMPLETE')).toBe(true);
    expect(tdd?.workflow.nodes.some((n) => n.loop?.until === 'TESTS_PASS')).toBe(true);
  });

  it('models refactor-safely as parallel gates off a single node', () => {
    const refactor = getWorkflowTemplate('refactor-safely');
    const gates = refactor?.workflow.nodes.filter(
      (n) => n.dependsOn?.length === 1 && n.dependsOn[0] === 'refactor',
    );
    expect(gates?.length).toBe(3);
    expect(refactor?.workflow.nodes.some((n) => n.continueOnError)).toBe(true);
  });

  it('fans out at least five parallel reviewers converging on one synthesizer in multi-agent-review', () => {
    const template = getWorkflowTemplate('multi-agent-review');
    expect(template).toBeDefined();
    const synth = template!.workflow.nodes.find((n) => n.id === 'synthesize');
    expect(synth).toBeDefined();
    const reviewerIds = synth!.dependsOn ?? [];
    expect(reviewerIds.length).toBeGreaterThanOrEqual(5);
    const reviewers = template!.workflow.nodes.filter((n) => reviewerIds.includes(n.id));
    expect(reviewers.every((n) => n.type === 'agent')).toBe(true);
    expect(reviewers.every((n) => Boolean(n.instructions) && !n.command)).toBe(true);
    const upstreams = new Set(reviewers.map((n) => (n.dependsOn ?? []).join(',')));
    expect(upstreams.size).toBe(1);
  });

  it('drives a self-fix loop until REVIEW_CLEAN in review-and-fix', () => {
    const template = getWorkflowTemplate('review-and-fix');
    expect(template).toBeDefined();
    const loopNode = template!.workflow.nodes.find((n) => n.loop?.until === 'REVIEW_CLEAN');
    expect(loopNode).toBeDefined();
    expect(loopNode!.type).toBe('agent');
    expect(loopNode!.loop!.maxIterations).toBeGreaterThanOrEqual(1);
    expect(template!.workflow.nodes.some((n) => n.type === 'scm' && n.action === 'open_pull_request')).toBe(true);
  });

  it('gives the investigating agent skills before an agent-drafted PR in context-aware-fix', () => {
    const template = getWorkflowTemplate('context-aware-fix');
    expect(template).toBeDefined();
    const nodes = template!.workflow.nodes;
    expect(nodes.some((n) => (n.skills?.length ?? 0) > 0)).toBe(true);
    const pr = nodes.find((n) => n.type === 'scm' && n.action === 'open_pull_request');
    expect(pr?.agentGenerated).toBe(true);
    expect(pr?.provider).toBeTruthy();
  });

  it('fans an agent and a shell node out over a bounded matrix in fan-out-migration', () => {
    const template = getWorkflowTemplate('fan-out-migration');
    expect(template).toBeDefined();
    const matrixNodes = template!.workflow.nodes.filter((n) => n.matrix);
    expect(matrixNodes.map((n) => n.type).sort()).toEqual(['agent', 'shell']);
    for (const node of matrixNodes) {
      expect(Array.isArray(node.matrix!.items)).toBe(true);
      expect(node.matrix!.as).toBe('package');
      expect(node.matrix!.maxParallel).toBeGreaterThanOrEqual(1);
      expect(node.loop).toBeUndefined();
    }
  });

  it('announces via notify and comment message nodes in ship-and-announce', () => {
    const template = getWorkflowTemplate('ship-and-announce');
    expect(template).toBeDefined();
    const messages = template!.workflow.nodes.filter((n) => n.type === 'message');
    const targets = messages.map((n) => n.messageTarget).sort();
    expect(targets).toEqual(['comment', 'notify']);
    expect(messages.every((n) => n.agentGenerated && Boolean(n.message))).toBe(true);
    const pr = template!.workflow.nodes.find((n) => n.type === 'scm');
    expect(pr?.agentGenerated).toBe(true);
  });

  it('renders a workflow block as YAML that parses back into a config', () => {
    const template = getWorkflowTemplate('default');
    expect(template).toBeDefined();
    const yaml = renderWorkflowTemplateYaml(template!);
    expect(yaml).toContain('workflow:');
    expect(yaml).toContain('open_pull_request');
  });

  it('summarizes a template for the UI', () => {
    const summary = toWorkflowTemplateSummary(getWorkflowTemplate('default')!);
    expect(summary.name).toBe('default');
    expect(summary.nodeCount).toBe(5);
    expect(summary.nodeTypes).toEqual(expect.arrayContaining(['agent', 'shell', 'approval', 'scm']));
  });

  it('returns undefined for an unknown template', () => {
    expect(getWorkflowTemplate('does-not-exist')).toBeUndefined();
  });
});
