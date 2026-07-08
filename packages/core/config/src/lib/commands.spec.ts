import { describe, it, expect } from 'vitest';
import { renderTemplate, resolveNodeReference } from './commands.js';

describe('resolveNodeReference', () => {
  const outputs: Record<string, unknown> = {
    investigate: { finalResponse: 'Use the portal', confidence: 0.95 },
    lint: { stdout: 'ok', stderr: '' },
    values: [1, 2, 3],
  };

  it('returns undefined for a missing node id', () => {
    expect(resolveNodeReference(outputs, 'missing', [])).toBeUndefined();
  });

  it('returns the full output object when no path segments given', () => {
    expect(resolveNodeReference(outputs, 'lint', [])).toEqual({ stdout: 'ok', stderr: '' });
  });

  it('walks a dot-path into the output object', () => {
    expect(resolveNodeReference(outputs, 'investigate', ['finalResponse'])).toBe('Use the portal');
  });

  it('walks a nested dot-path', () => {
    expect(resolveNodeReference(outputs, 'lint', ['stdout'])).toBe('ok');
  });

  it('returns the array value directly', () => {
    expect(resolveNodeReference(outputs, 'values', [])).toEqual([1, 2, 3]);
  });

  it('returns undefined when a dot-path segment does not exist', () => {
    expect(resolveNodeReference(outputs, 'investigate', ['nope'])).toBeUndefined();
  });

  it('returns undefined when intermediate path is not an object', () => {
    expect(resolveNodeReference(outputs, 'investigate', ['finalResponse', 'deep'])).toBeUndefined();
  });

  it('handles null output value', () => {
    const withNull = { n: null };
    expect(resolveNodeReference(withNull, 'n', [])).toBeUndefined();
  });
});

describe('renderTemplate with nodeOutputs', () => {
  const vars = { ARGUMENTS: 'Fix bug', REPOSITORY: 'my-repo' };

  it('$VAR interpolation still works', () => {
    const result = renderTemplate('Repo: $REPOSITORY, Args: ${ARGUMENTS}', vars);
    expect(result).toBe('Repo: my-repo, Args: Fix bug');
  });

  it('leaves unknown $VAR untouched', () => {
    expect(renderTemplate('$UNKNOWN', {})).toBe('$UNKNOWN');
  });

  it('replaces {{ nodes.x }} with object serialized as JSON', () => {
    const outputs = { investigate: { finalResponse: 'done' } };
    const result = renderTemplate('Result: {{ nodes.investigate }}', vars, outputs);
    expect(result).toBe('Result: {"finalResponse":"done"}');
  });

  it('replaces {{ nodes.x.field }} with the field value', () => {
    const outputs = { investigate: { finalResponse: 'Use react' } };
    const result = renderTemplate('Outcome: {{ nodes.investigate.finalResponse }}', vars, outputs);
    expect(result).toBe('Outcome: Use react');
  });

  it('replaces {{ nodes.x.field.sub }} with nested field value', () => {
    const outputs = { s: { stdout: 'build passed', stderr: '' } };
    const result = renderTemplate('STDOUT: {{ nodes.s.stdout }}', {}, outputs);
    expect(result).toBe('STDOUT: build passed');
  });

  it('leaves missing node reference untouched', () => {
    const outputs = { a: { v: 1 } };
    const result = renderTemplate('{{ nodes.missing }}', {}, outputs);
    expect(result).toBe('{{ nodes.missing }}');
  });

  it('leaves missing dot-path untouched', () => {
    const outputs = { a: { v: 1 } };
    const result = renderTemplate('{{ nodes.a.nope }}', {}, outputs);
    expect(result).toBe('{{ nodes.a.nope }}');
  });

  it('does not explode with no nodeOutputs', () => {
    const result = renderTemplate('$ARGUMENTS {{ nodes.x }}', vars);
    expect(result).toBe('Fix bug {{ nodes.x }}');
  });

  it('works with whitespace around the id', () => {
    const outputs = { x: 'hello' };
    const result = renderTemplate('{{ nodes.x }} and {{  nodes.x  }}', {}, outputs);
    expect(result).toBe('hello and hello');
  });
});

describe('renderTemplate with scope', () => {
  it('replaces {{ matrix.item }} with a string item', () => {
    const result = renderTemplate('Item: {{ matrix.item }}', {}, undefined, {
      matrix: { item: 'src/app.ts', index: 0, total: 2 },
    });
    expect(result).toBe('Item: src/app.ts');
  });

  it('replaces {{ matrix.item.field }} with a nested field value', () => {
    const result = renderTemplate('Name: {{ matrix.item.name }}', {}, undefined, {
      matrix: { item: { name: 'alpha' }, index: 0, total: 1 },
    });
    expect(result).toBe('Name: alpha');
  });

  it('serializes an object item as JSON', () => {
    const result = renderTemplate('{{ matrix.item }}', {}, undefined, {
      matrix: { item: { a: 1 }, index: 0, total: 1 },
    });
    expect(result).toBe('{"a":1}');
  });

  it('leaves a missing scope path untouched', () => {
    const result = renderTemplate('{{ matrix.item.nope }}', {}, undefined, {
      matrix: { item: { name: 'alpha' }, index: 0, total: 1 },
    });
    expect(result).toBe('{{ matrix.item.nope }}');
  });

  it('leaves an unknown root untouched', () => {
    const result = renderTemplate('{{ other.x }}', {}, undefined, {
      matrix: { item: 'a', index: 0, total: 1 },
    });
    expect(result).toBe('{{ other.x }}');
  });

  it('still resolves {{ nodes.* }} alongside a scope', () => {
    const result = renderTemplate(
      '{{ nodes.plan.finalResponse }} :: {{ matrix.item }}',
      {},
      { plan: { finalResponse: 'done' } },
      { matrix: { item: 'x', index: 0, total: 1 } },
    );
    expect(result).toBe('done :: x');
  });
});
