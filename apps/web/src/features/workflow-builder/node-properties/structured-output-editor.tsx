import type { StructuredFieldType, StructuredOutputConfig } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusIcon, XIcon } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from './fields';

const STRUCTURED_TYPES: StructuredFieldType[] = ['string', 'number', 'boolean', 'array', 'object'];

export function StructuredOutputEditor({
  value,
  onChange,
}: {
  value: StructuredOutputConfig;
  onChange: (value: StructuredOutputConfig) => void;
}) {
  const entries = Object.entries(value.schema);
  const required = new Set(value.required ?? []);

  const renameField = (oldName: string, newName: string) => {
    const schema: Record<string, StructuredFieldType> = {};
    for (const [k, v] of Object.entries(value.schema)) schema[k === oldName ? newName : k] = v;
    const req = (value.required ?? []).map((r) => (r === oldName ? newName : r));
    onChange({ schema, required: req });
  };
  const setType = (name: string, type: StructuredFieldType) => {
    onChange({ ...value, schema: { ...value.schema, [name]: type } });
  };
  const removeField = (name: string) => {
    const schema = { ...value.schema };
    delete schema[name];
    onChange({ schema, required: (value.required ?? []).filter((r) => r !== name) });
  };
  const toggleRequired = (name: string, on: boolean) => {
    const req = new Set(value.required ?? []);
    if (on) req.add(name);
    else req.delete(name);
    onChange({ ...value, required: [...req] });
  };
  const addField = () => {
    let i = 1;
    let name = 'field';
    while (name in value.schema) {
      i += 1;
      name = `field_${i}`;
    }
    onChange({ ...value, schema: { ...value.schema, [name]: 'string' } });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      {entries.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No fields yet. Add one below.</p>
      )}
      {entries.map(([name, type]) => (
        <div key={name} className="flex flex-col gap-1.5 rounded-md bg-muted/40 p-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={name}
              onChange={(e) => renameField(name, e.target.value)}
              className="h-8 flex-1"
              placeholder="field"
            />
            <Select value={type} onValueChange={(v) => setType(name, v as StructuredFieldType)}>
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRUCTURED_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => removeField(name)}
              aria-label="Remove field"
            >
              <XIcon />
            </Button>
          </div>
          <Checkbox checked={required.has(name)} onChange={(on) => toggleRequired(name, on)}>
            <span className="text-xs">Required</span>
          </Checkbox>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addField}>
        <PlusIcon data-icon="inline-start" />
        Add field
      </Button>
    </div>
  );
}
