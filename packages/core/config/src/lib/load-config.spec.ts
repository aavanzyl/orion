import { describe, it, expect } from 'vitest';
import { parseProjectConfig } from './load-config.js';
import { renderTemplate } from './commands.js';
import { ConfigError } from './errors.js';

const validYaml = `
project:
  name: demo
  defaultBranch: main
board:
  swimlanes: [backlog, in_progress, review, done]
workflow:
  name: default
  nodes:
    - id: investigate
      type: agent
      provider: codex
      model: gpt-5-codex
      command: commands/investigate.md
      swimlane: in_progress
    - id: approval
      type: approval
      dependsOn: [investigate]
      swimlane: review
    - id: open_pr
      type: scm
      action: open_pull_request
      dependsOn: [approval]
      swimlane: done
`;

describe('parseProjectConfig', () => {
  it('parses a valid config', () => {
    const config = parseProjectConfig(validYaml);
    expect(config.project.name).toBe('demo');
    expect(config.workflow.nodes).toHaveLength(3);
  });

  it('rejects an agent node without a provider', () => {
    const bad = validYaml.replace('provider: codex', '');
    expect(() => parseProjectConfig(bad)).toThrow(ConfigError);
  });

  it('rejects a node column outside the board', () => {
    const bad = validYaml.replace('swimlane: review', 'swimlane: nonexistent');
    expect(() => parseProjectConfig(bad)).toThrow(ConfigError);
  });

  it('parses advisory continueOnError nodes', () => {
    const yaml = `
project: { name: c, defaultBranch: main }
board: { swimlanes: [x] }
workflow:
  name: default
  nodes:
    - { id: lint, type: shell, script: "eslint .", swimlane: x, continueOnError: true }
    - { id: build, type: shell, script: "tsc", swimlane: x, dependsOn: [lint] }
`;
    const config = parseProjectConfig(yaml);
    expect(config.workflow.nodes[0].continueOnError).toBe(true);
    expect(config.workflow.nodes[1].continueOnError).toBeUndefined();
  });

  it('detects dependency cycles', () => {
    const cyclic = `
project: { name: c, defaultBranch: main }
board: { swimlanes: [x] }
workflow:
  name: default
  nodes:
    - { id: n1, type: agent, provider: codex, dependsOn: [n2] }
    - { id: n2, type: agent, provider: codex, dependsOn: [n1] }
`;
    expect(() => parseProjectConfig(cyclic)).toThrow(/DAG|cycle/i);
  });

  it('parses global and per-node MCP servers', () => {
    const yaml = `
project: { name: c, defaultBranch: main }
mcpServers:
  context7:
    command: npx
    args: [-y, "@upstash/context7-mcp"]
board: { swimlanes: [x] }
workflow:
  name: default
  nodes:
    - id: n1
      type: agent
      provider: codex
      swimlane: x
      mcpServers:
        github:
          command: npx
          args: [-y, "@modelcontextprotocol/server-github"]
          env: { GITHUB_TOKEN: abc }
        http-tools:
          url: https://mcp.example.com/sse
          bearerToken: secret
`;
    const config = parseProjectConfig(yaml);
    expect(config.mcpServers?.context7.command).toBe('npx');
    expect(config.workflow.nodes[0].mcpServers?.github.env).toEqual({ GITHUB_TOKEN: 'abc' });
    expect(config.workflow.nodes[0].mcpServers?.['http-tools'].url).toBe('https://mcp.example.com/sse');
  });

  it('rejects an MCP server missing both command and url', () => {
    const bad = `
project: { name: c, defaultBranch: main }
board: { swimlanes: [x] }
workflow:
  name: default
  nodes:
    - id: n1
      type: agent
      provider: codex
      swimlane: x
      mcpServers:
        broken:
          env: { FOO: bar }
`;
    expect(() => parseProjectConfig(bad)).toThrow(ConfigError);
  });
});

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    const out = renderTemplate('Issue: $ARGUMENTS on $BASE_BRANCH', {
      ARGUMENTS: 'fix login',
      BASE_BRANCH: 'main',
    });
    expect(out).toBe('Issue: fix login on main');
  });

  it('leaves unknown variables untouched', () => {
    expect(renderTemplate('$UNKNOWN', {})).toBe('$UNKNOWN');
  });
});
