import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SCM_ACTIONS, SCM_ACTION_LABELS } from '../node-model';
import {
  Checkbox,
  FieldLabel,
  NumberField,
  configString,
  setConfig,
  type NodeTypeEditorProps,
} from './fields';

const MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;

/** Split a comma-separated string into a trimmed, empty-filtered array. */
function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Read a `config` array value back into a comma-separated string for display. */
function configListString(config: Record<string, unknown> | undefined, key: string): string {
  const value = config?.[key];
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(', ') : '';
}

/** Read a numeric `config` value (or undefined) for a `NumberField`. */
function configNumber(config: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = config?.[key];
  return typeof value === 'number' ? value : undefined;
}

/** A muted hint line rendered under a field. */
function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

/**
 * Property editor for `scm` nodes. Renders the action selector and,
 * per-action, the parameters that action consumes (branch pattern for
 * checkout, PR title/body/base for open_pull_request, tag/release details,
 * merge method, requested reviewers, etc.). Action parameters are stored on the
 * node's free-form `config` bag, which the backend actions already read.
 */
export function ScmProperties({ data, onChange }: NodeTypeEditorProps) {
  const config = data.config;
  const setConfigValue = (key: string, value: unknown) =>
    onChange({ config: setConfig(config, key, value) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Action</FieldLabel>
        <Select value={data.action || undefined} onValueChange={(v) => onChange({ action: v })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an action" />
          </SelectTrigger>
          <SelectContent>
            {SCM_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {SCM_ACTION_LABELS[a] ?? a}
              </SelectItem>
            ))}
            {data.action && !SCM_ACTIONS.includes(data.action as (typeof SCM_ACTIONS)[number]) && (
              <SelectItem value={data.action}>{data.action}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {data.action === 'checkout_branch' && (
        <>
          <Separator />
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Branch format</FieldLabel>
            <Input
              value={configString(config, 'branchFormat')}
              onChange={(e) => setConfigValue('branchFormat', e.target.value)}
              placeholder="project default"
            />
            <FieldHint>
              Overrides the project branch format template. Supports $VARIABLE substitution.
            </FieldHint>
          </div>
        </>
      )}

      {data.action === 'open_pull_request' && (
        <>
          <Separator />
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={Boolean(data.agentGenerated)}
              onChange={(v) => onChange({ agentGenerated: v || undefined })}
            >
              Let an agent write the title & description
            </Checkbox>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help">
                  <InfoIcon className="size-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                An agent drafts the PR title and description from the run's changes. The fields below
                become optional guidance for that draft.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{data.agentGenerated ? 'Title guidance' : 'Title'}</FieldLabel>
            <Input
              value={configString(config, 'title')}
              onChange={(e) => setConfigValue('title', e.target.value)}
              placeholder="Orion: ticket title"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{data.agentGenerated ? 'Description guidance' : 'Body'}</FieldLabel>
            <Textarea
              value={configString(config, 'body')}
              onChange={(e) => setConfigValue('body', e.target.value)}
              className="min-h-20 text-sm"
              spellCheck={false}
            />
          </div>

          {data.agentGenerated && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Provider</FieldLabel>
                <Input
                  value={data.provider ?? ''}
                  onChange={(e) => onChange({ provider: e.target.value || undefined })}
                  placeholder="e.g. codex"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>Model</FieldLabel>
                <Input
                  value={data.model ?? ''}
                  onChange={(e) => onChange({ model: e.target.value || undefined })}
                  placeholder="e.g. gpt-5-codex"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Base branch</FieldLabel>
            <Input
              value={configString(config, 'base')}
              onChange={(e) => setConfigValue('base', e.target.value)}
              placeholder="repo default branch"
            />
          </div>
        </>
      )}

      {data.action === 'tag_release' && (
        <>
          <Separator />
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Tag</FieldLabel>
            <Input
              value={configString(config, 'tag')}
              onChange={(e) => setConfigValue('tag', e.target.value)}
              placeholder="v1.2.3"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Message</FieldLabel>
            <Input
              value={configString(config, 'message')}
              onChange={(e) => setConfigValue('message', e.target.value)}
              placeholder="Annotated tag message"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Release name</FieldLabel>
            <Input
              value={configString(config, 'name')}
              onChange={(e) => setConfigValue('name', e.target.value)}
              placeholder="Release name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Release notes</FieldLabel>
            <Textarea
              value={configString(config, 'body')}
              onChange={(e) => setConfigValue('body', e.target.value)}
              className="min-h-20 text-sm"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Checkbox
              checked={config?.release === true}
              onChange={(v) => setConfigValue('release', v || undefined)}
            >
              Publish hosted release
            </Checkbox>
            <Checkbox
              checked={config?.draft === true}
              onChange={(v) => setConfigValue('draft', v || undefined)}
            >
              Draft
            </Checkbox>
            <Checkbox
              checked={config?.prerelease === true}
              onChange={(v) => setConfigValue('prerelease', v || undefined)}
            >
              Prerelease
            </Checkbox>
          </div>
        </>
      )}

      {data.action === 'merge' && (
        <>
          <Separator />
          <NumberField
            label="Pull request number"
            value={configNumber(config, 'pr')}
            onChange={(v) => setConfigValue('pr', v)}
            placeholder="auto-resolve from upstream"
          />
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Method</FieldLabel>
            <Select
              value={(configString(config, 'method') || 'merge') as (typeof MERGE_METHODS)[number]}
              onValueChange={(v) => setConfigValue('method', v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MERGE_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Commit title</FieldLabel>
            <Input
              value={configString(config, 'commitTitle')}
              onChange={(e) => setConfigValue('commitTitle', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Commit message</FieldLabel>
            <Input
              value={configString(config, 'commitMessage')}
              onChange={(e) => setConfigValue('commitMessage', e.target.value)}
            />
          </div>
        </>
      )}

      {data.action === 'review' && (
        <>
          <Separator />
          <NumberField
            label="Pull request number"
            value={configNumber(config, 'pr')}
            onChange={(v) => setConfigValue('pr', v)}
            placeholder="auto-resolve from upstream"
          />
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Reviewers</FieldLabel>
            <Textarea
              value={configListString(config, 'reviewers')}
              onChange={(e) => {
                const list = splitCommaList(e.target.value);
                setConfigValue('reviewers', list.length > 0 ? list : undefined);
              }}
              placeholder="alice, bob"
              className="min-h-16 text-sm"
              spellCheck={false}
            />
            <FieldHint>Comma-separated GitHub usernames.</FieldHint>
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Team reviewers</FieldLabel>
            <Textarea
              value={configListString(config, 'teamReviewers')}
              onChange={(e) => {
                const list = splitCommaList(e.target.value);
                setConfigValue('teamReviewers', list.length > 0 ? list : undefined);
              }}
              placeholder="backend, platform"
              className="min-h-16 text-sm"
              spellCheck={false}
            />
            <FieldHint>Comma-separated team slugs.</FieldHint>
          </div>
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={config?.requireApproval === true}
              onChange={(v) => setConfigValue('requireApproval', v || undefined)}
            >
              Require approval
            </Checkbox>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground cursor-help">
                  <InfoIcon className="size-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                When enabled, the node fails unless the PR has an approving review and no requested
                changes.
              </TooltipContent>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  );
}
