import type { LoopConfig } from '@orion/models';
import { Input } from '@/components/ui/input';
import { FieldLabel, Checkbox, NumberField } from './fields';

export function LoopEditor({
  loop,
  onChange,
}: {
  loop: LoopConfig;
  onChange: (loop: LoopConfig) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <NumberField
        label="Max iterations"
        value={loop.maxIterations}
        onChange={(v) => onChange({ ...loop, maxIterations: v ?? 1 })}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Until (stop substring)</FieldLabel>
        <Input
          value={loop.until}
          onChange={(e) => onChange({ ...loop, until: e.target.value })}
          placeholder="DONE"
        />
      </div>
      <Checkbox
        checked={Boolean(loop.freshContext)}
        onChange={(v) => onChange({ ...loop, freshContext: v })}
      >
        Fresh context each iteration
      </Checkbox>
    </div>
  );
}
