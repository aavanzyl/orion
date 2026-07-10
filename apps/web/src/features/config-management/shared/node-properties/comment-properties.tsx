import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { configString, FieldLabel, type NodeTypeEditorProps, setConfig } from './fields';

const PROVIDER_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: '__custom__', label: 'Custom…' },
];

export function CommentProperties({ data, onChange }: NodeTypeEditorProps) {
  const provider = data.provider ?? 'linear';
  const isCustom = !PROVIDER_OPTIONS.slice(0, -1).some((o) => o.value === provider);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Message</FieldLabel>
        <Textarea
          value={data.message ?? ''}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="PR opened: {{ nodes.pr.pullRequests }}"
          className="min-h-20 text-sm"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Supports <code>{'{{'} nodes.id.path {'}}'}</code> substitution.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>Provider</FieldLabel>
        {!isCustom ? (
          <Select
            value={provider}
            onValueChange={(v) => {
              if (v === '__custom__') {
                onChange({ provider: undefined });
              } else {
                onChange({ provider: v });
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={provider}
            onChange={(e) => onChange({ provider: e.target.value || undefined })}
            placeholder="linear"
          />
        )}
        <p className="text-[11px] text-muted-foreground">
          Posts on the run's ticket in the tracker.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <FieldLabel>Comment title</FieldLabel>
        <Input
          value={configString(data.config, 'title')}
          onChange={(e) =>
            onChange({
              config: setConfig(data.config, 'title', e.target.value || undefined),
            })
          }
          placeholder="Orion"
        />
        <p className="text-[11px] text-muted-foreground">
          Optional title prefix for the comment. Supports template substitution.
        </p>
      </div>
    </div>
  );
}
