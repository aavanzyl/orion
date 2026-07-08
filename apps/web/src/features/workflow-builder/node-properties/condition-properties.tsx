import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { configString, FieldLabel, type NodeTypeEditorProps, setConfig } from './fields';

export function ConditionProperties({ data, onChange }: NodeTypeEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Condition expression</FieldLabel>
        <Input
          value={data.condition ?? ''}
          onChange={(e) => onChange({ condition: e.target.value })}
          placeholder="nodes.tests.exitCode == 0"
        />
        <p className="text-[11px] text-muted-foreground">
          When false, this node and its exclusive downstream branch are skipped.
        </p>
        <p className="text-[11px] text-muted-foreground">
          The engine skips this entire branch when the expression is false.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>Description (optional)</FieldLabel>
        <Textarea
          value={configString(data.config, 'description')}
          onChange={(e) =>
            onChange({
              config: setConfig(data.config, 'description', e.target.value || undefined),
            })
          }
          placeholder="Explain what this branch decision means"
          className="min-h-20 text-sm"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
