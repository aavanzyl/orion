import type { StructuredOutputConfig } from '@orion/models';

/**
 * Tolerantly extract a JSON object from text: prefer a ```json fenced block,
 * else take the last balanced `{...}` span. Returns `undefined` on failure.
 */
export function extractJson(text: string): unknown | undefined {
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i;
  const match = text.match(fence);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // fall through
    }
  }

  const start = text.lastIndexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return undefined;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function describeFieldType(t: string): string {
  switch (t) {
    case 'array':
      return 'an array';
    case 'object':
      return 'an object (non-array)';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    default:
      return `a ${t}`;
  }
}

function checkFieldType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    default:
      return false;
  }
}

/**
 * Validate that `value` is an object whose fields match the declared
 * `StructuredOutputConfig`. Returns `ok: true` with the data, or `ok: false`
 * with an error string describing the first problem found.
 */
export function validateStructuredOutput(
  value: unknown,
  config: StructuredOutputConfig,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'structured output must be a JSON object' };
  }

  const obj = value as Record<string, unknown>;

  for (const key of config.required ?? []) {
    if (!(key in obj)) {
      return { ok: false, error: `required field "${key}" is missing` };
    }
  }

  for (const key of Object.keys(obj)) {
    const expected = config.schema[key];
    if (!expected) continue;
    const val = obj[key];
    if (!checkFieldType(val, expected)) {
      return {
        ok: false,
        error: `field "${key}" should be ${describeFieldType(expected)} but got ${typeof val}${Array.isArray(val) ? ' (array)' : ''}`,
      };
    }
  }

  return { ok: true, data: obj };
}

/**
 * Build an instruction to be appended to the agent prompt telling the model to
 * end its response with a single JSON object matching the declared schema,
 * wrapped in a ```json fence.
 */
export function buildStructuredOutputInstruction(config: StructuredOutputConfig): string {
  const fields = Object.entries(config.schema)
    .map(([name, type]) => {
      const required = config.required?.includes(name) ? ' (required)' : '';
      return `  "${name}": ${describeFieldType(type)}${required}`;
    })
    .join(',\n');

  return [
    '',
    'After your final response, you MUST output a single JSON object wrapped in a ```json code fence with exactly these fields:',
    '{',
    fields,
    '}',
  ].join('\n');
}
