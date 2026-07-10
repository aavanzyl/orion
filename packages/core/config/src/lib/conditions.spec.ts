import { describe, it, expect } from 'vitest';
import {
  buildConditionExpression,
  evaluateCondition,
  parseSimpleCondition,
  tryEvaluateCondition,
} from './conditions.js';

const outputs: Record<string, unknown> = {
  review: { data: { approved: true, score: 8, tags: ['urgent', 'backend'], note: 'ship it' } },
  tests: { exitCode: 0 },
  lint: { data: { errors: 3 }, stdout: '' },
  empty: {},
};

describe('evaluateCondition', () => {
  it('resolves a node ref to a boolean value', () => {
    expect(evaluateCondition('nodes.review.data.approved', outputs)).toBe(true);
  });

  it('treats a missing ref as falsy', () => {
    expect(evaluateCondition('nodes.missing', outputs)).toBe(false);
    expect(evaluateCondition('nodes.review.data.nope', outputs)).toBe(false);
  });

  it('compares equality of a ref and a literal', () => {
    expect(evaluateCondition('nodes.review.data.approved == true', outputs)).toBe(true);
    expect(evaluateCondition('nodes.review.data.approved == false', outputs)).toBe(false);
    expect(evaluateCondition("nodes.review.data.note == 'ship it'", outputs)).toBe(true);
  });

  it('supports != inequality', () => {
    expect(evaluateCondition('nodes.tests.exitCode != 0', outputs)).toBe(false);
    expect(evaluateCondition('nodes.tests.exitCode != 1', outputs)).toBe(true);
  });

  it('does numeric comparisons when both sides are numbers', () => {
    expect(evaluateCondition('nodes.review.data.score > 5', outputs)).toBe(true);
    expect(evaluateCondition('nodes.review.data.score >= 8', outputs)).toBe(true);
    expect(evaluateCondition('nodes.lint.data.errors < 1', outputs)).toBe(false);
    expect(evaluateCondition('nodes.lint.data.errors <= 3', outputs)).toBe(true);
  });

  it('falls back to string comparison when not both numbers', () => {
    expect(evaluateCondition("nodes.review.data.note < 'z'", outputs)).toBe(true);
    expect(evaluateCondition("'apple' < 'banana'", outputs)).toBe(true);
  });

  it('supports includes for arrays and strings', () => {
    expect(evaluateCondition("nodes.review.data.tags includes 'urgent'", outputs)).toBe(true);
    expect(evaluateCondition("nodes.review.data.tags includes 'frontend'", outputs)).toBe(false);
    expect(evaluateCondition("nodes.review.data.note includes 'ship'", outputs)).toBe(true);
  });

  it('supports matches with a regex string', () => {
    expect(evaluateCondition("nodes.review.data.note matches '^ship'", outputs)).toBe(true);
    expect(evaluateCondition("nodes.review.data.note matches 'nope'", outputs)).toBe(false);
  });

  it('combines with && and ||', () => {
    expect(
      evaluateCondition('nodes.review.data.approved && nodes.tests.exitCode == 0', outputs),
    ).toBe(true);
    expect(
      evaluateCondition('nodes.review.data.approved && nodes.lint.data.errors == 0', outputs),
    ).toBe(false);
    expect(
      evaluateCondition('nodes.lint.data.errors == 0 || nodes.review.data.approved', outputs),
    ).toBe(true);
  });

  it('applies unary ! negation', () => {
    expect(evaluateCondition('!nodes.review.data.approved', outputs)).toBe(false);
    expect(evaluateCondition('!nodes.missing', outputs)).toBe(true);
  });

  it('honours precedence: || is lower than &&', () => {
    expect(
      evaluateCondition('nodes.missing && nodes.missing || nodes.review.data.approved', outputs),
    ).toBe(true);
  });

  it('supports parentheses grouping', () => {
    expect(
      evaluateCondition('(nodes.missing || nodes.review.data.approved) && nodes.tests.exitCode == 0', outputs),
    ).toBe(true);
  });

  it('treats empty object/array/string/zero as falsy', () => {
    expect(evaluateCondition('nodes.empty', outputs)).toBe(false);
    expect(evaluateCondition('nodes.tests.exitCode', outputs)).toBe(false);
    expect(evaluateCondition('0', outputs)).toBe(false);
    expect(evaluateCondition("''", outputs)).toBe(false);
    expect(evaluateCondition('nodes.review.data.tags', outputs)).toBe(true);
  });

  it('evaluates bare literals', () => {
    expect(evaluateCondition('true', outputs)).toBe(true);
    expect(evaluateCondition('false', outputs)).toBe(false);
    expect(evaluateCondition('null', outputs)).toBe(false);
    expect(evaluateCondition('42', outputs)).toBe(true);
  });

  it('returns false for a malformed expression', () => {
    expect(evaluateCondition('nodes.', outputs)).toBe(false);
    expect(evaluateCondition('== 5', outputs)).toBe(false);
    expect(evaluateCondition('nodes.a &&', outputs)).toBe(false);
    expect(evaluateCondition('foo bar', outputs)).toBe(false);
  });
});

describe('tryEvaluateCondition', () => {
  it('reports ok:true with the value for a valid expression', () => {
    expect(tryEvaluateCondition('nodes.review.data.score > 5', outputs)).toEqual({
      ok: true,
      value: true,
    });
  });

  it('reports ok:false with an error for a malformed expression', () => {
    const result = tryEvaluateCondition('nodes.a ==', outputs);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('treats unknown refs as fine (ok:true) against an empty map', () => {
    expect(tryEvaluateCondition('nodes.whatever.data.x == 1', {}).ok).toBe(true);
  });
});

describe('parseSimpleCondition', () => {
  it('parses a single comparison of a ref against a literal', () => {
    const parsed = parseSimpleCondition('nodes.review.data.score >= 5');
    expect(parsed).toEqual({
      connector: 'and',
      comparisons: [
        {
          negated: false,
          left: { kind: 'ref', id: 'review', path: ['data', 'score'] },
          op: '>=',
          right: { kind: 'lit', value: 5 },
        },
      ],
    });
  });

  it('parses a bare ref as a truthiness check (no operator)', () => {
    const parsed = parseSimpleCondition('nodes.review.data.approved');
    expect(parsed?.comparisons[0]).toEqual({
      negated: false,
      left: { kind: 'ref', id: 'review', path: ['data', 'approved'] },
    });
  });

  it('parses a negated comparison', () => {
    const parsed = parseSimpleCondition("!(nodes.a.status == 'done')");
    expect(parsed?.comparisons[0]).toMatchObject({ negated: true, op: '==' });
  });

  it('flattens a chain joined by a single connector', () => {
    const parsed = parseSimpleCondition('nodes.a.x == 1 && nodes.b.y == 2 && nodes.c');
    expect(parsed?.connector).toBe('and');
    expect(parsed?.comparisons).toHaveLength(3);
  });

  it('returns an empty comparison list for an empty expression', () => {
    expect(parseSimpleCondition('   ')).toEqual({ connector: 'and', comparisons: [] });
  });

  it('returns null when connectors are mixed', () => {
    expect(parseSimpleCondition('nodes.a || nodes.b && nodes.c')).toBeNull();
  });

  it('returns null for a malformed expression', () => {
    expect(parseSimpleCondition('nodes.a ==')).toBeNull();
  });
});

describe('buildConditionExpression', () => {
  it('serialises a comparison with a quoted string literal', () => {
    const expr = buildConditionExpression({
      connector: 'and',
      comparisons: [
        {
          negated: false,
          left: { kind: 'ref', id: 'review', path: ['status'] },
          op: '==',
          right: { kind: 'lit', value: 'done' },
        },
      ],
    });
    expect(expr).toBe("nodes.review.status == 'done'");
  });

  it('joins rows with the chosen connector and negates with parentheses', () => {
    const expr = buildConditionExpression({
      connector: 'or',
      comparisons: [
        {
          negated: true,
          left: { kind: 'ref', id: 'a', path: ['ok'] },
          op: '==',
          right: { kind: 'lit', value: true },
        },
        { negated: false, left: { kind: 'ref', id: 'b', path: [] } },
      ],
    });
    expect(expr).toBe('!(nodes.a.ok == true) || nodes.b');
  });

  it('skips incomplete rows (ref without an id)', () => {
    const expr = buildConditionExpression({
      connector: 'and',
      comparisons: [
        { negated: false, left: { kind: 'ref', id: '', path: [] } },
        { negated: false, left: { kind: 'ref', id: 'b', path: [] } },
      ],
    });
    expect(expr).toBe('nodes.b');
  });

  it('round-trips parse -> build for representable expressions', () => {
    for (const expr of [
      'nodes.review.data.score >= 5',
      "nodes.a.status == 'done' && nodes.b.ready == true",
      'nodes.a.tags includes \'urgent\' || nodes.b',
    ]) {
      const parsed = parseSimpleCondition(expr);
      expect(parsed).not.toBeNull();
      expect(buildConditionExpression(parsed as NonNullable<typeof parsed>)).toBe(expr);
    }
  });
});
