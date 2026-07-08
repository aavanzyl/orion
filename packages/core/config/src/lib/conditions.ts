import { resolveNodeReference } from './commands.js';

/**
 * Result of a non-throwing condition evaluation. `ok` is false only when the
 * expression fails to tokenize/parse; runtime resolution of missing refs never
 * fails (they resolve to `undefined`).
 */
export interface ConditionResult {
  ok: boolean;
  value: boolean;
  error?: string;
}

/**
 * A small, safe boolean expression evaluator for workflow `when` conditions.
 * There is no `eval`/`Function`; expressions are tokenized and parsed with a
 * recursive-descent parser.
 *
 * Grammar (precedence low → high): `||`, then `&&`, then unary `!`, then a
 * single comparison. Parentheses group sub-expressions.
 *
 * Operands:
 * - node refs `nodes.<id>` or `nodes.<id>.<dotpath>` (resolved via
 *   {@link resolveNodeReference}); missing refs are `undefined` (falsy).
 * - string literals in single or double quotes; numeric literals;
 *   `true` / `false` / `null`.
 *
 * Comparisons: `==`, `!=`, `<`, `>`, `<=`, `>=` (numeric when both operands are
 * numbers, else string compare), plus `includes` (left array/string contains
 * right) and `matches` (right is a regex string tested against left).
 *
 * A bare operand is truthy per a JS-like rule: non-empty string, non-zero
 * number, `true`, and non-empty array/object are truthy; `null`/`undefined`,
 * `0`, `''` and empty array/object are falsy.
 *
 * Examples:
 * - `nodes.review.data.approved == true`
 * - `nodes.tests.exitCode == 0 && nodes.lint.data.errors < 1`
 * - `nodes.plan.data.tags includes 'urgent'`
 * - `!nodes.review.data.blocked || nodes.override`
 *
 * @example
 * evaluateCondition("nodes.a.data.n > 2", { a: { data: { n: 3 } } }) // true
 */
export function evaluateCondition(
  expr: string,
  nodeOutputs: Record<string, unknown>,
): boolean {
  return tryEvaluateCondition(expr, nodeOutputs).value;
}

/**
 * Like {@link evaluateCondition} but never throws and surfaces parse errors.
 * Returns `{ ok: false, value: false, error }` on a malformed expression.
 */
export function tryEvaluateCondition(
  expr: string,
  nodeOutputs: Record<string, unknown>,
): ConditionResult {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return { ok: true, value: truthy(evaluate(ast, nodeOutputs)) };
  } catch (err) {
    return { ok: false, value: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type Token =
  | { kind: 'ref'; id: string; path: string[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'op'; value: CompareOp }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

type CompareOp = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'includes' | 'matches';

const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_]/;
const ID_CHAR = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = '';
      while (j < input.length && input[j] !== c) {
        if (input[j] === '\\' && j + 1 < input.length) {
          value += input[j + 1];
          j += 2;
          continue;
        }
        value += input[j];
        j++;
      }
      if (j >= input.length) throw new Error(`unterminated string literal`);
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if (two === '&&') {
      tokens.push({ kind: 'and' });
      i += 2;
      continue;
    }
    if (two === '||') {
      tokens.push({ kind: 'or' });
      i += 2;
      continue;
    }
    if (c === '<' || c === '>') {
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    if (c === '!') {
      tokens.push({ kind: 'not' });
      i++;
      continue;
    }
    if (DIGIT.test(c) || (c === '-' && i + 1 < input.length && DIGIT.test(input[i + 1]))) {
      let j = i + 1;
      while (j < input.length && (DIGIT.test(input[j]) || input[j] === '.')) j++;
      const raw = input.slice(i, j);
      const value = Number(raw);
      if (Number.isNaN(value)) throw new Error(`invalid number literal "${raw}"`);
      tokens.push({ kind: 'number', value });
      i = j;
      continue;
    }
    if (WORD_START.test(c)) {
      let j = i;
      while (j < input.length && WORD_CHAR.test(input[j])) j++;
      const word = input.slice(i, j);

      if (word === 'nodes') {
        if (input[j] !== '.') throw new Error(`expected "." after "nodes"`);
        j++;
        let k = j;
        while (k < input.length && ID_CHAR.test(input[k])) k++;
        if (k === j) throw new Error(`expected node id after "nodes."`);
        const id = input.slice(j, k);
        const path: string[] = [];
        while (input[k] === '.') {
          k++;
          let s = k;
          while (s < input.length && WORD_CHAR.test(input[s])) s++;
          if (s === k) throw new Error(`expected path segment after "."`);
          path.push(input.slice(k, s));
          k = s;
        }
        tokens.push({ kind: 'ref', id, path });
        i = k;
        continue;
      }
      if (word === 'true' || word === 'false') {
        tokens.push({ kind: 'bool', value: word === 'true' });
      } else if (word === 'null') {
        tokens.push({ kind: 'null' });
      } else if (word === 'includes' || word === 'matches') {
        tokens.push({ kind: 'op', value: word });
      } else {
        throw new Error(`unexpected token "${word}"`);
      }
      i = j;
      continue;
    }

    throw new Error(`unexpected character "${c}"`);
  }

  return tokens;
}

type Node =
  | { kind: 'or'; left: Node; right: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'not'; operand: Node }
  | { kind: 'cmp'; op: CompareOp; left: Node; right: Node }
  | { kind: 'ref'; id: string; path: string[] }
  | { kind: 'lit'; value: unknown };

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (this.tokens.length === 0) throw new Error('empty expression');
    const node = this.parseOr();
    if (this.pos < this.tokens.length) throw new Error('unexpected trailing tokens');
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek()?.kind === 'or') {
      this.pos++;
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.peek()?.kind === 'and') {
      this.pos++;
      left = { kind: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.peek()?.kind === 'not') {
      this.pos++;
      return { kind: 'not', operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parsePrimary();
    const next = this.peek();
    if (next?.kind === 'op') {
      this.pos++;
      const right = this.parsePrimary();
      return { kind: 'cmp', op: next.value, left, right };
    }
    return left;
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (!token) throw new Error('unexpected end of expression');
    switch (token.kind) {
      case 'lparen': {
        this.pos++;
        const inner = this.parseOr();
        if (this.peek()?.kind !== 'rparen') throw new Error('missing closing parenthesis');
        this.pos++;
        return inner;
      }
      case 'ref':
        this.pos++;
        return { kind: 'ref', id: token.id, path: token.path };
      case 'string':
        this.pos++;
        return { kind: 'lit', value: token.value };
      case 'number':
        this.pos++;
        return { kind: 'lit', value: token.value };
      case 'bool':
        this.pos++;
        return { kind: 'lit', value: token.value };
      case 'null':
        this.pos++;
        return { kind: 'lit', value: null };
      default:
        throw new Error(`unexpected token "${token.kind}"`);
    }
  }
}

function evaluate(node: Node, outputs: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'or':
      return truthy(evaluate(node.left, outputs)) || truthy(evaluate(node.right, outputs));
    case 'and':
      return truthy(evaluate(node.left, outputs)) && truthy(evaluate(node.right, outputs));
    case 'not':
      return !truthy(evaluate(node.operand, outputs));
    case 'cmp':
      return compare(node.op, evaluate(node.left, outputs), evaluate(node.right, outputs));
    case 'ref':
      return resolveNodeReference(outputs, node.id, node.path);
    case 'lit':
      return node.value;
  }
}

function compare(op: CompareOp, a: unknown, b: unknown): boolean {
  switch (op) {
    case '==':
      return looseEquals(a, b);
    case '!=':
      return !looseEquals(a, b);
    case 'includes':
      if (Array.isArray(a)) return a.some((item) => looseEquals(item, b));
      if (typeof a === 'string') return a.includes(String(b));
      return false;
    case 'matches':
      try {
        return new RegExp(String(b)).test(String(a));
      } catch {
        return false;
      }
    default: {
      if (typeof a === 'number' && typeof b === 'number') {
        return relational(op, a, b);
      }
      return relational(op, String(a), String(b));
    }
  }
}

function relational(op: '<' | '>' | '<=' | '>=', a: number | string, b: number | string): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return String(a) === String(b);
}

function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}
