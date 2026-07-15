import { useEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import {
  buildConditionExpression,
  parseSimpleCondition,
  tryEvaluateCondition,
  type SimpleComparison,
  type SimpleCondition,
  type SimpleOperand,
} from '@orion/config/conditions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type OperandType = 'ref' | 'string' | 'number' | 'boolean' | 'null';

interface OperandState {
  type: OperandType;
  id: string;
  path: string;
  text: string;
  bool: boolean;
}

interface RowState {
  negated: boolean;
  left: OperandState;
  op: string;
  right: OperandState;
}

const TRUTHY = '__truthy__';

const OPERATORS: { value: string; label: string }[] = [
  { value: TRUTHY, label: 'is truthy' },
  { value: '==', label: '== equals' },
  { value: '!=', label: '!= not equals' },
  { value: '<', label: '< less than' },
  { value: '<=', label: '<= at most' },
  { value: '>', label: '> greater than' },
  { value: '>=', label: '>= at least' },
  { value: 'includes', label: 'includes' },
  { value: 'matches', label: 'matches (regex)' },
];

const OPERAND_TYPES: { value: OperandType; label: string }[] = [
  { value: 'ref', label: 'Node' },
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'null', label: 'Null' },
];

function emptyOperand(type: OperandType = 'string'): OperandState {
  return { type, id: '', path: '', text: '', bool: false };
}

function emptyRow(): RowState {
  return { negated: false, left: emptyOperand('ref'), op: TRUTHY, right: emptyOperand('string') };
}

function operandFromModel(operand: SimpleOperand): OperandState {
  if (operand.kind === 'ref') {
    return { type: 'ref', id: operand.id, path: operand.path.join('.'), text: '', bool: false };
  }
  const value = operand.value;
  if (value === null) return emptyOperand('null');
  if (typeof value === 'number') return { ...emptyOperand('number'), text: String(value) };
  if (typeof value === 'boolean') return { ...emptyOperand('boolean'), bool: value };
  return { ...emptyOperand('string'), text: String(value) };
}

function rowFromModel(comparison: SimpleComparison): RowState {
  return {
    negated: comparison.negated,
    left: operandFromModel(comparison.left),
    op: comparison.op ?? TRUTHY,
    right: comparison.right ? operandFromModel(comparison.right) : emptyOperand('string'),
  };
}

function stateFromCondition(condition: SimpleCondition): {
  connector: 'and' | 'or';
  rows: RowState[];
} {
  const rows = condition.comparisons.map(rowFromModel);
  return { connector: condition.connector, rows: rows.length ? rows : [emptyRow()] };
}

function operandToModel(operand: OperandState): SimpleOperand | null {
  switch (operand.type) {
    case 'ref': {
      const id = operand.id.trim();
      if (!id) return null;
      const path = operand.path
        .split('.')
        .map((segment) => segment.trim())
        .filter(Boolean);
      return { kind: 'ref', id, path };
    }
    case 'number': {
      if (operand.text.trim() === '') return null;
      const value = Number(operand.text);
      if (Number.isNaN(value)) return null;
      return { kind: 'lit', value };
    }
    case 'boolean':
      return { kind: 'lit', value: operand.bool };
    case 'null':
      return { kind: 'lit', value: null };
    default:
      return { kind: 'lit', value: operand.text };
  }
}

function rowsToExpression(connector: 'and' | 'or', rows: RowState[]): string {
  const comparisons: SimpleComparison[] = [];
  for (const row of rows) {
    const left = operandToModel(row.left);
    if (!left) continue;
    if (row.op === TRUTHY) {
      comparisons.push({ negated: row.negated, left });
      continue;
    }
    const right = operandToModel(row.right);
    if (!right) continue;
    comparisons.push({ negated: row.negated, left, op: row.op as SimpleComparison['op'], right });
  }
  return buildConditionExpression({ connector, comparisons });
}

export interface ExpressionBuilderProps {
  value: string;
  onChange: (value: string) => void;
  referenceOptions?: string[];
}

export function ExpressionBuilder({ value, onChange, referenceOptions = [] }: ExpressionBuilderProps) {
  const parsed = parseSimpleCondition(value);
  const canGuide = parsed !== null;
  const [mode, setMode] = useState<'guided' | 'raw'>(canGuide ? 'guided' : 'raw');

  const initial = stateFromCondition(parsed ?? { connector: 'and', comparisons: [] });
  const [connector, setConnector] = useState<'and' | 'or'>(initial.connector);
  const [rows, setRows] = useState<RowState[]>(initial.rows);
  const lastEmitted = useRef(value);

  // Re-hydrate the guided fields when the expression changes from the outside
  // (e.g. switching branches or an external edit), but ignore our own emits.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const next = parseSimpleCondition(value);
    if (next) {
      const hydrated = stateFromCondition(next);
      setConnector(hydrated.connector);
      setRows(hydrated.rows);
    }
  }, [value]);

  const emit = (nextConnector: 'and' | 'or', nextRows: RowState[]) => {
    setConnector(nextConnector);
    setRows(nextRows);
    const expr = rowsToExpression(nextConnector, nextRows);
    lastEmitted.current = expr;
    onChange(expr);
  };

  const updateRow = (index: number, patch: Partial<RowState>) => {
    emit(
      connector,
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const updateOperand = (index: number, side: 'left' | 'right', patch: Partial<OperandState>) => {
    updateRow(index, { [side]: { ...rows[index][side], ...patch } });
  };

  const addRow = () => emit(connector, [...rows, emptyRow()]);
  const removeRow = (index: number) =>
    emit(connector, rows.length > 1 ? rows.filter((_, i) => i !== index) : [emptyRow()]);

  const validation = tryEvaluateCondition(value || 'true', {});

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex overflow-hidden rounded-md border">
          {(['guided', 'raw'] as const).map((m) => {
            const disabled = m === 'guided' && !canGuide;
            return (
              <button
                key={m}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m)}
                title={disabled ? 'Expression is too complex for the guided builder' : undefined}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                  mode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground',
                  disabled && 'cursor-not-allowed opacity-40 hover:text-muted-foreground',
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
        {rows.length > 1 && mode === 'guided' && (
          <Select value={connector} onValueChange={(v) => emit(v as 'and' | 'or', rows)}>
            <SelectTrigger size="sm" className="w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">Match all (&amp;&amp;)</SelectItem>
              <SelectItem value="or">Match any (||)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {mode === 'guided' ? (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-col gap-1 rounded-md border bg-background p-1.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateRow(index, { negated: !row.negated })}
                  title="Negate this condition"
                  className={cn(
                    'h-8 w-7 shrink-0 rounded border font-mono text-sm',
                    row.negated
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground',
                  )}
                >
                  not
                </button>
                <OperandFields
                  operand={row.left}
                  onChange={(patch) => updateOperand(index, 'left', patch)}
                  referenceOptions={referenceOptions}
                />
                {rows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeRow(index)}
                    aria-label="Remove condition"
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1 pl-8">
                <Select value={row.op} onValueChange={(v) => updateRow(index, { op: v })}>
                  <SelectTrigger size="sm" className="w-36 shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {row.op !== TRUTHY && (
                  <OperandFields
                    operand={row.right}
                    onChange={(patch) => updateOperand(index, 'right', patch)}
                    referenceOptions={referenceOptions}
                  />
                )}
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addRow} className="w-fit">
            <PlusIcon data-icon="inline-start" />
            Add condition
          </Button>

          <code className="rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {value.trim() || '(empty — always matches)'}
          </code>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Input
            value={value}
            onChange={(e) => {
              lastEmitted.current = e.target.value;
              onChange(e.target.value);
            }}
            placeholder="nodes.review.data.score >= 5"
            className="h-8 font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            Refs: <code>nodes.&lt;id&gt;.&lt;path&gt;</code> · ops:{' '}
            <code>== != &lt; &gt; &lt;= &gt;= includes matches</code> · combine with{' '}
            <code>&amp;&amp; || !</code> and parentheses.
          </p>
          {value.trim() && !validation.ok && (
            <p className="text-[11px] text-destructive">{validation.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function OperandFields({
  operand,
  onChange,
  referenceOptions,
}: {
  operand: OperandState;
  onChange: (patch: Partial<OperandState>) => void;
  referenceOptions: string[];
}) {
  return (
    <div className="flex flex-1 items-center gap-1">
      <Select value={operand.type} onValueChange={(v) => onChange({ type: v as OperandType })}>
        <SelectTrigger size="sm" className="w-[92px] shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERAND_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {operand.type === 'ref' && (
        <>
          <Select value={operand.id || ''} onValueChange={(v) => onChange({ id: v })}>
            <SelectTrigger size="sm" className="w-28 shrink-0 text-xs">
              <SelectValue placeholder="node" />
            </SelectTrigger>
            <SelectContent>
              {referenceOptions.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={operand.path}
            onChange={(e) => onChange({ path: e.target.value })}
            placeholder="data.score"
            className="h-8 flex-1 font-mono text-xs"
            spellCheck={false}
          />
        </>
      )}

      {(operand.type === 'string' || operand.type === 'number') && (
        <Input
          value={operand.text}
          onChange={(e) => onChange({ text: e.target.value })}
          type={operand.type === 'number' ? 'number' : 'text'}
          placeholder={operand.type === 'number' ? '0' : 'value'}
          className="h-8 flex-1 font-mono text-xs"
          spellCheck={false}
        />
      )}

      {operand.type === 'boolean' && (
        <Select
          value={operand.bool ? 'true' : 'false'}
          onValueChange={(v) => onChange({ bool: v === 'true' })}
        >
          <SelectTrigger size="sm" className="flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      )}

      {operand.type === 'null' && (
        <span className="flex h-8 flex-1 items-center px-2 font-mono text-xs text-muted-foreground">
          null
        </span>
      )}
    </div>
  );
}
