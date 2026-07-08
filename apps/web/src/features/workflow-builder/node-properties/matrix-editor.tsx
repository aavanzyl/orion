import type { MatrixConfig } from '@orion/models';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldLabel, NumberField } from './fields';

export function MatrixEditor({
  matrix,
  onChange,
}: {
  matrix: MatrixConfig;
  onChange: (matrix: MatrixConfig) => void;
}) {
  const isReference = typeof matrix.items === 'string';
  const asText = isReference
    ? (matrix.items as string)
    : JSON.stringify(matrix.items as unknown[], null, 2);
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          className={`rounded px-2 py-1 ${isReference ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
          onClick={() => onChange({ ...matrix, items: '' })}
        >
          Reference
        </button>
        <button
          type="button"
          className={`rounded px-2 py-1 ${!isReference ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
          onClick={() => onChange({ ...matrix, items: [] })}
        >
          Literal list
        </button>
      </div>
      {isReference ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Items reference</FieldLabel>
          <Input
            value={matrix.items as string}
            onChange={(e) => onChange({ ...matrix, items: e.target.value })}
            placeholder="nodes.plan.data.files"
          />
          <p className="text-[11px] text-muted-foreground">
            A path into an upstream node's output that yields an array.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Items (JSON array)</FieldLabel>
          <Textarea
            value={asText}
            spellCheck={false}
            className="min-h-24 font-mono text-xs"
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                if (Array.isArray(parsed)) onChange({ ...matrix, items: parsed });
              } catch {
                // keep last valid value while the user is mid-edit
              }
            }}
            placeholder={'["a", "b", "c"]'}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Item name (as)</FieldLabel>
          <Input
            value={matrix.as ?? ''}
            onChange={(e) => onChange({ ...matrix, as: e.target.value.trim() || undefined })}
            placeholder="item"
          />
          <p className="text-[11px] text-muted-foreground">
            Exposes each item as <code>${'{'}NAME{'}'}</code> and{' '}
            <code>{'{{'} matrix.name {'}}'}</code>.
          </p>
        </div>
        <NumberField
          label="Max parallel"
          value={matrix.maxParallel}
          onChange={(v) => onChange({ ...matrix, maxParallel: v })}
          placeholder="unbounded"
        />
      </div>
    </div>
  );
}
