import { describe, it, expect } from 'vitest';
import type { StructuredOutputConfig } from '@orion/models';
import { buildStructuredOutputInstruction, extractJson, validateStructuredOutput } from './structured-output.js';

describe('extractJson', () => {
  it('extracts from a ```json fenced block', () => {
    const text = 'Here is some prose.\n```json\n{"severity":"high","areas":["auth","db"]}\n```\nMore text.';
    expect(extractJson(text)).toEqual({ severity: 'high', areas: ['auth', 'db'] });
  });

  it('extracts from a plain ``` fenced block', () => {
    const text = '```\n{"x": 1}\n```';
    expect(extractJson(text)).toEqual({ x: 1 });
  });

  it('extracts the last balanced bare {…} when no fence exists', () => {
    const text = 'Some text { "key": "value" } trailing.';
    expect(extractJson(text)).toEqual({ key: 'value' });
  });

  it('handles trailing prose after the JSON object', () => {
    const text = 'I did some things.\n\n{"done": true}\n\nLet me know if you need more.';
    expect(extractJson(text)).toEqual({ done: true });
  });

  it('returns undefined for text with no JSON', () => {
    expect(extractJson('just prose, nothing structured')).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(extractJson('{ key: value }')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(extractJson('')).toBeUndefined();
  });

  it('falls through to bare extraction when fence JSON is invalid', () => {
    const text = '```json\n{invalid}\n```\n\n{"ok": true}';
    expect(extractJson(text)).toEqual({ ok: true });
  });
});

describe('validateStructuredOutput', () => {
  const config: StructuredOutputConfig = {
    schema: { severity: 'string', count: 'number', enabled: 'boolean', tags: 'array', meta: 'object' },
    required: ['severity'],
  };

  it('returns ok:true for a valid payload', () => {
    const result = validateStructuredOutput(
      { severity: 'high', count: 5, enabled: true, tags: ['a'], meta: {} },
      config,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.severity).toBe('high');
    }
  });

  it('returns error when value is an array', () => {
    const result = validateStructuredOutput([1, 2, 3], config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must be a JSON object');
  });

  it('returns error when value is null', () => {
    const result = validateStructuredOutput(null, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('must be a JSON object');
  });

  it('returns error when a required field is missing', () => {
    const result = validateStructuredOutput({ count: 5 }, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('severity');
  });

  it('returns error for a type mismatch (string expected, number given)', () => {
    const result = validateStructuredOutput({ severity: 42 }, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('severity');
  });

  it('returns error for a type mismatch (array expected, object given)', () => {
    const result = validateStructuredOutput({ severity: 'high', tags: { not: 'array' } }, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('tags');
  });

  it('returns error for a type mismatch (object expected, array given)', () => {
    const result = validateStructuredOutput({ severity: 'high', meta: ['not', 'object'] }, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('meta');
  });

  it('returns error for a type mismatch (boolean expected, string given)', () => {
    const result = validateStructuredOutput({ severity: 'high', enabled: 'yes' }, config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('enabled');
  });

  it('ignores extra fields not in the schema', () => {
    const result = validateStructuredOutput(
      { severity: 'low', extra: 'unchecked' },
      config,
    );
    expect(result.ok).toBe(true);
  });
});

describe('buildStructuredOutputInstruction', () => {
  const config: StructuredOutputConfig = {
    schema: { severity: 'string', areas: 'array' },
    required: ['severity'],
  };

  it('mentions each key and type', () => {
    const instruction = buildStructuredOutputInstruction(config);
    expect(instruction).toContain('"severity"');
    expect(instruction).toContain('a string');
    expect(instruction).toContain('"areas"');
    expect(instruction).toContain('an array');
  });

  it('marks required fields', () => {
    const instruction = buildStructuredOutputInstruction(config);
    expect(instruction).toContain('(required)');
    expect(instruction).toContain('```json');
  });
});
