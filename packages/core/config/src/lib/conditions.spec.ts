import { describe, it, expect } from 'vitest';
import { evaluateCondition, tryEvaluateCondition } from './conditions.js';

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
