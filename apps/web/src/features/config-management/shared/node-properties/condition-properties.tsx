import { useMemo } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import type { ConditionBranch } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { configString, FieldLabel, type NodeTypeEditorProps, setConfig } from './fields';
import { ExpressionBuilder } from './expression-builder';

function branchLabel(index: number, isLast: boolean, hasExpression: boolean): string {
  if (index === 0) return 'If';
  if (!hasExpression && isLast) return 'Else';
  return 'Else if';
}

function buildBranches(data: NodeTypeEditorProps['data']): ConditionBranch[] {
  if (data.branches?.length) return data.branches;
  if (data.condition) return [{ expression: data.condition }];
  return [];
}

export function ConditionProperties({
  data,
  onChange,
  targetOptions = [],
  referenceOptions = [],
}: NodeTypeEditorProps) {
  const branches = useMemo(() => buildBranches(data), [data.branches, data.condition]);
  const noneLabel = '__none__';

  const updateBranch = (index: number, patch: Partial<ConditionBranch>) => {
    const next = branches.map((b, i) => (i === index ? { ...b, ...patch } : b));
    const cleaned = next.map((b) => {
      const c: ConditionBranch = {};
      if (b.expression?.trim()) c.expression = b.expression.trim();
      if (b.target?.trim()) c.target = b.target.trim();
      return c;
    });
    const hasContent = cleaned.some((b) => b.expression || b.target);
    onChange({ branches: hasContent ? cleaned : undefined, condition: undefined });
  };

  const addBranch = () => {
    const next = [...branches, {} as ConditionBranch];
    onChange({ branches: next, condition: undefined });
  };

  const removeBranch = (index: number) => {
    const next = branches.filter((_, i) => i !== index);
    onChange({ branches: next.length ? next : undefined, condition: undefined });
  };

  const hasElse = branches.length > 0 && !branches[branches.length - 1].expression;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Branches (if / else-if / else)</FieldLabel>
        <p className="text-[11px] text-muted-foreground">
          Expressions are evaluated in order. The first truthy branch is taken; an
          &ldquo;Else&rdquo; branch (no expression) catches the rest. Each branch may
          route to a specific downstream node via a target.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {branches.map((branch, index) => {
          const isLast = index === branches.length - 1;
          const isElse = hasElse && isLast;
          return (
            <div key={index} className="flex flex-col gap-2 rounded-md border p-2">
              <div className="flex items-center gap-1.5">
                <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">
                  {branchLabel(index, isLast, !!branch.expression)}
                </span>
                <Select
                  value={branch.target || noneLabel}
                  onValueChange={(v) =>
                    updateBranch(index, { target: v === noneLabel ? undefined : v })
                  }
                >
                  <SelectTrigger size="sm" className="flex-1 text-xs">
                    <SelectValue placeholder="no target" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={noneLabel}>no target</SelectItem>
                    {targetOptions.map((key) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {branches.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeBranch(index)}
                    aria-label="Remove branch"
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
              {isElse ? (
                <p className="pl-14 text-[11px] text-muted-foreground">
                  Else — runs when no branch above matches.
                </p>
              ) : (
                <ExpressionBuilder
                  value={branch.expression ?? ''}
                  onChange={(expression) =>
                    updateBranch(index, { expression: expression || undefined })
                  }
                  referenceOptions={referenceOptions}
                />
              )}
            </div>
          );
        })}
      </div>

      <Button variant="outline" size="sm" onClick={addBranch} className="w-fit">
        <PlusIcon data-icon="inline-start" />
        Add {hasElse ? 'else-if' : branches.length === 0 ? 'if' : 'else-if'} branch
      </Button>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>Description (optional)</FieldLabel>
        <Input
          value={configString(data.config, 'description')}
          onChange={(e) =>
            onChange({ config: setConfig(data.config, 'description', e.target.value || undefined) })
          }
          placeholder="Explain what this branch decision means"
          className="text-sm"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
