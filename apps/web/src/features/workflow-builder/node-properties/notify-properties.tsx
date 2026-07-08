import type { NotificationLevel } from '@orion/models';
import { InfoIcon } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FieldLabel, type NodeTypeEditorProps, configString, setConfig } from './fields';

/**
 * Property editor for `notify` nodes. Renders the message template, target
 * provider key (e.g. `slack`, `webhook`), severity level, and any
 * provider-specific parameters stored on the free-form `config` bag (channel,
 * custom title, etc.).
 */
export function NotifyProperties({ data, onChange }: NodeTypeEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Message</FieldLabel>
        <Textarea
          value={data.message ?? ''}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder="Deploy finished: {{ nodes.build.status }}"
          className="min-h-20 text-sm"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Supports <code>{'{{'} nodes.id.path {'}}'}</code> substitution.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Provider</FieldLabel>
          <Select
            value={data.provider ?? ''}
            onValueChange={(v) => onChange({ provider: v || undefined })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All registered" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Leave empty to fan-out to every registered notifier.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Level</FieldLabel>
          <Select
            value={data.level ?? 'info'}
            onValueChange={(v) => onChange({ level: v as NotificationLevel })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="warn">warn</SelectItem>
              <SelectItem value="error">error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium text-muted-foreground">Advanced</p>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <FieldLabel>Title</FieldLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help">
                  <InfoIcon className="size-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Overrides the notification title. Supports template substitution.
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            value={configString(data.config, 'title')}
            onChange={(e) => onChange({ config: setConfig(data.config, 'title', e.target.value) })}
            placeholder="Orion (default)"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <FieldLabel>Channel</FieldLabel>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help">
                  <InfoIcon className="size-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Slack channel to post to (requires a bot-token notifier, not a webhook). Leave empty for the webhook's default channel.
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            value={configString(data.config, 'channel')}
            onChange={(e) => onChange({ config: setConfig(data.config, 'channel', e.target.value) })}
            placeholder="#deploys"
          />
        </div>
      </div>
    </div>
  );
}
