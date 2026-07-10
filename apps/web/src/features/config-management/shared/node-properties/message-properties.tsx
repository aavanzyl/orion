import type { MessageTarget, NotificationLevel } from '@orion/models';
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

const COMMENT_PROVIDER_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: '__custom__', label: 'Custom…' },
];

/**
 * Property editor for the unified `message` node. A target selector switches
 * between delivering a notification (Slack/webhook) and posting a comment on the
 * run's ticket. An "agent-generated" toggle lets an agent draft the body instead
 * of authoring a static template.
 */
export function MessageProperties({ data, onChange }: NodeTypeEditorProps) {
  const target: MessageTarget = data.messageTarget ?? 'notify';
  const agentGenerated = Boolean(data.agentGenerated);
  const commentProvider = data.provider ?? 'linear';
  const isCustomCommentProvider = !COMMENT_PROVIDER_OPTIONS.slice(0, -1).some(
    (o) => o.value === commentProvider,
  );

  const setTarget = (next: MessageTarget) => {
    // Provider semantics differ per target; reset it so a Slack key doesn't leak
    // into a comment node (and vice versa).
    onChange({ messageTarget: next, provider: undefined });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Target</FieldLabel>
        <Select value={target} onValueChange={(v) => setTarget(v as MessageTarget)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="notify">Notify — send a notification</SelectItem>
            <SelectItem value="comment">Comment — post on the ticket</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={agentGenerated}
          onChange={(e) => onChange({ agentGenerated: e.target.checked || undefined })}
        />
        <span className="font-medium">Let an agent write the message</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground cursor-help">
              <InfoIcon className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            An agent drafts the message from the run's changes. The text below becomes optional
            guidance for that draft instead of the literal body.
          </TooltipContent>
        </Tooltip>
      </label>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>{agentGenerated ? 'Guidance (optional)' : 'Message'}</FieldLabel>
        <Textarea
          value={data.message ?? ''}
          onChange={(e) => onChange({ message: e.target.value })}
          placeholder={
            agentGenerated
              ? 'e.g. Keep it under 3 sentences and mention the ticket id'
              : 'Deploy finished: {{ nodes.build.status }}'
          }
          className="min-h-20 text-sm"
          spellCheck={false}
        />
        {!agentGenerated && (
          <p className="text-[11px] text-muted-foreground">
            Supports <code>{'{{'} nodes.id.path {'}}'}</code> substitution.
          </p>
        )}
      </div>

      {target === 'notify' ? (
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
      ) : (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Provider</FieldLabel>
          {!isCustomCommentProvider ? (
            <Select
              value={commentProvider}
              onValueChange={(v) =>
                onChange({ provider: v === '__custom__' ? undefined : v })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMENT_PROVIDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={commentProvider}
              onChange={(e) => onChange({ provider: e.target.value || undefined })}
              placeholder="linear"
            />
          )}
          <p className="text-[11px] text-muted-foreground">
            Posts on the run's ticket in the tracker.
          </p>
        </div>
      )}

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
                {target === 'notify'
                  ? 'Overrides the notification title. Supports template substitution.'
                  : 'Optional title prefix for the comment. Supports template substitution.'}
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            value={configString(data.config, 'title')}
            onChange={(e) => onChange({ config: setConfig(data.config, 'title', e.target.value) })}
            placeholder="Orion"
          />
        </div>

        {target === 'notify' && (
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
                  Slack channel to post to (requires a bot-token notifier, not a webhook). Leave
                  empty for the webhook's default channel.
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              value={configString(data.config, 'channel')}
              onChange={(e) =>
                onChange({ config: setConfig(data.config, 'channel', e.target.value) })
              }
              placeholder="#deploys"
            />
          </div>
        )}
      </div>
    </div>
  );
}
