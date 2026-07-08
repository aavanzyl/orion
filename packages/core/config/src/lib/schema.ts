import { z } from 'zod';

export const mcpServerConfigSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().url().optional(),
    bearerToken: z.string().min(1).optional(),
  })
  .refine((s) => Boolean(s.command) || Boolean(s.url), {
    message: 'an MCP server must define either "command" (stdio) or "url" (http)',
  });

export const mcpServerMapSchema = z.record(z.string().min(1), mcpServerConfigSchema);

export const boardConfigSchema = z
  .object({
    swimlanes: z.array(z.string().min(1)).min(1).optional(),
    columns: z.array(z.string().min(1)).min(1).optional(),
    triggers: z
      .record(
        z.string().min(1),
        z.union([z.string().min(1), z.array(z.string().min(1))]),
      )
      .optional(),
  })
  .refine((data) => (data.swimlanes ?? data.columns) !== undefined, {
    message: 'Either swimlanes or columns is required',
  });

export const loopConfigSchema = z.object({
  maxIterations: z.number().int().min(1),
  until: z.string().min(1),
  freshContext: z.boolean().optional(),
});

export const matrixConfigSchema = z.object({
  items: z.union([z.array(z.unknown()), z.string().min(1)]),
  as: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'matrix.as must be a simple identifier')
    .optional(),
  maxParallel: z.number().int().min(1).optional(),
});

export const structuredOutputConfigSchema = z.object({
  schema: z
    .record(z.enum(['string', 'number', 'boolean', 'array', 'object']))
    .refine((s) => Object.keys(s).length > 0, {
      message: 'structuredOutput.schema must have at least one field',
    }),
  required: z.array(z.string()).optional(),
});

export const retrievalConfigSchema = z.object({
  query: z.string().optional(),
  topK: z.number().int().positive().max(20).optional(),
});

export const workflowNodeConfigSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'agent',
    'approval',
    'scm',
    'shell',
    'workflow',
    'notify',
    'comment',
    'condition',
    'http',
  ]),
  provider: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  instructions: z.string().optional(),
  skills: z.array(z.string().min(1)).optional(),
  mcpServers: mcpServerMapSchema.optional(),
  config: z.record(z.unknown()).optional(),
  command: z.string().optional(),
  prompt: z.string().optional(),
  workflow: z.string().min(1).optional(),
  action: z.string().optional(),
  script: z.string().optional(),
  message: z.string().optional(),
  level: z.enum(['info', 'warn', 'error']).optional(),
  condition: z.string().min(1).optional(),
  url: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  token: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  when: z.string().min(1).optional(),
  swimlane: z.string().optional(),
  retries: z.number().int().min(0).optional(),
  retryDelayMs: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(1).optional(),
  continueOnError: z.boolean().optional(),
  loop: loopConfigSchema.optional(),
  matrix: matrixConfigSchema.optional(),
  structuredOutput: structuredOutputConfigSchema.optional(),
  retrieval: retrievalConfigSchema.optional(),
});

export const budgetConfigSchema = z
  .object({
    maxTokens: z.number().int().positive().optional(),
    maxCostUsd: z.number().positive().optional(),
  })
  .optional();

export const workflowConfigSchema = z.object({
  name: z.string().min(1).default('default'),
  nodes: z.array(workflowNodeConfigSchema).min(1),
  budget: budgetConfigSchema,
});

export const projectConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    defaultBranch: z.string().min(1).default('main'),
    branchFormat: z.string().optional(),
  }),
  mcpServers: mcpServerMapSchema.optional(),
  workflows: z.record(z.string().min(1), workflowConfigSchema).optional(),
  board: boardConfigSchema,
  workflow: workflowConfigSchema,
});

export type ProjectConfigInput = z.input<typeof projectConfigSchema>;
