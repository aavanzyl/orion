import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, SparklesIcon, TrashIcon, XIcon, PlayIcon, HistoryIcon, SquarePenIcon, CheckCircle2Icon, XCircleIcon, RefreshCwIcon } from 'lucide-react';
import { toast } from 'sonner';
import type {
  BoardSwimlane,
  Label as LabelModel,
  Ticket,
  TicketPriority,
  TicketRelationKind,
  TicketType,
  UpdateTicketInput,
  WorkflowRun,
} from '@orion/models';
import { ACTIVE_RUN_STATUSES, ALL_DEFAULT_TICKET_TYPES } from '@orion/models';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { MarkdownEditor } from '@/components/markdown-editor';
import { Markdown } from '@/components/markdown';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RunLogViewer } from '@/components/run-log-viewer';
import { api } from '@/lib/api';
import { useTicketDetail } from './hooks';
import { UpdateTicketAiModal } from './update-ticket-ai-modal';
import { PrioritySelect, PRIORITY_META, PriorityIcon } from './priority';
import { LabelPicker, LabelBadge } from './label-picker';
import { RELATION_KINDS, RelationKindSelect, TicketSelect } from './ticket-picker';

interface TicketSheetProps {
  ticket: Ticket | null;
  projectId: string | null;
  labels: LabelModel[];
  tickets: Ticket[];
  epicTickets: Ticket[];
  swimlanes: BoardSwimlane[];
  ticketTypes?: { value: string; label: string }[];
  onCreateLabel: (name: string, color: string) => Promise<void>;
  onClose: () => void;
  onChanged: () => void;
  onMoveTicket?: (ticketId: string, swimlane: string, force?: string) => Promise<void>;
}

export function TicketSheet({
  ticket,
  projectId,
  labels,
  tickets,
  epicTickets,
  swimlanes,
  ticketTypes,
  onCreateLabel,
  onClose,
  onChanged,
  onMoveTicket,
}: TicketSheetProps) {
  const { detail, refetch } = useTicketDetail(ticket?.id ?? null);

  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');
  const [title, setTitle] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [description, setDescription] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [relationKind, setRelationKind] = useState<TicketRelationKind>('blocks');
  const [relationTicketId, setRelationTicketId] = useState<string | undefined>();

  const [deletingTicket, setDeletingTicket] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const [updateAiModalOpen, setUpdateAiModalOpen] = useState(false);

  const current = detail ?? ticket;

  useEffect(() => {
    setTitle(current?.title ?? '');
    setDescription(current?.description ?? '');
    setViewMode('view');
  }, [current?.id]);

  useEffect(() => {
    if (detail) setDescription(detail.description);
  }, [detail?.id]);

  useEffect(() => {
    if (!ticket) return;
    setRunsLoading(true);
    api.listTicketRuns(ticket.id)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false));
  }, [ticket?.id]);

  const otherTickets = useMemo(
    () => tickets.filter((t) => t.id !== ticket?.id),
    [tickets, ticket?.id],
  );

  const patch = async (input: UpdateTicketInput) => {
    if (!ticket) return;
    try {
      await api.updateTicket(ticket.id, input);
      refetch();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveTitle = async () => {
    if (!ticket) return;
    const trimmed = title.trim();
    const previous = current?.title ?? '';
    if (!trimmed) {
      setTitle(previous);
      return;
    }
    if (trimmed === previous) return;
    setSavingTitle(true);
    try {
      await api.updateTicket(ticket.id, { title: trimmed });
      refetch();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
      setTitle(previous);
    } finally {
      setSavingTitle(false);
    }
  };

  const toggleLabel = (labelId: string) => {
    if (!detail) return;
    const next = detail.labelIds.includes(labelId)
      ? detail.labelIds.filter((id) => id !== labelId)
      : [...detail.labelIds, labelId];
    void patch({ labelIds: next });
  };

  const saveDescription = async () => {
    if (!detail || description === detail.description) return;
    await patch({ description });
  };

  const handleSaveAndClose = async () => {
    await saveDescription();
    onClose();
  };

  const moveToSwimlane = async (swimlane: string) => {
    if (!ticket) return;
    if (onMoveTicket) {
      await onMoveTicket(ticket.id, swimlane);
      refetch();
      onChanged();
      return;
    }
    try {
      await api.moveTicket(ticket.id, swimlane);
      refetch();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addRelation = async () => {
    if (!ticket || !relationTicketId) return;
    try {
      await api.addTicketRelation(ticket.id, relationKind, relationTicketId);
      setRelationTicketId(undefined);
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeRelation = async (relationId: string) => {
    try {
      await api.removeTicketRelation(relationId);
      refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const [deletingRelation, setDeletingRelation] = useState<string | null>(null);

  const confirmRemoveRelation = async () => {
    if (!deletingRelation) return;
    await removeRelation(deletingRelation);
  };

  const confirmDeleteTicket = async () => {
    if (!ticket) return;
    try {
      await api.deleteTicket(ticket.id);
      toast.success('Ticket deleted');
      onClose();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addSubIssue = async () => {
    if (!projectId || !ticket || !subTitle.trim()) return;
    try {
      await api.createTicket(projectId, {
        title: subTitle.trim(),
        swimlane: ticket.swimlane,
        parentId: ticket.id,
      });
      setSubTitle('');
      refetch();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const typeLabel = (ticketTypes ?? ALL_DEFAULT_TICKET_TYPES).find((t) => t.value === detail?.type)?.label ?? detail?.type;
  const swimlaneLabel = swimlanes.find((s) => s.key === current?.swimlane)?.title ?? current?.swimlane;

  const formatDate = (d?: string) => {
    if (!d) return null;
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const isEditing = viewMode === 'edit';

  return (
    <>
    <Sheet open={!!ticket} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="sr-only">Ticket details</SheetTitle>
          {isEditing ? (
            <div className="flex items-center gap-2">
              {current?.displayKey && (
                <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                  {current.displayKey}
                </Badge>
              )}
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === 'Escape') {
                    setTitle(current?.title ?? '');
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                disabled={savingTitle}
                className="flex-1 text-base font-semibold"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setUpdateAiModalOpen(true)}
                    className="size-8 shrink-0 text-violet-500 hover:text-violet-700 hover:bg-violet-50 animate-pulse-glow"
                  >
                    <SparklesIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ask the agent to update this ticket</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {current?.displayKey && (
                <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                  {current.displayKey}
                </Badge>
              )}
              <h3 className="flex-1 text-base font-semibold">{current?.title}</h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setUpdateAiModalOpen(true)}
                    className="size-8 shrink-0 text-violet-500 hover:text-violet-700 hover:bg-violet-50 animate-pulse-glow"
                  >
                    <SparklesIcon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ask the agent to update this ticket</TooltipContent>
              </Tooltip>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-4 py-4">
            {isEditing ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Type</Label>
                    <Select
                      value={detail?.type ?? 'feature'}
                      onValueChange={(v) => patch({ type: v as TicketType })}
                    >
                      <SelectTrigger className="w-full bg-white dark:bg-zinc-800">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(ticketTypes ?? ALL_DEFAULT_TICKET_TYPES).map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Swimlane</Label>
                    <Select value={current?.swimlane} onValueChange={moveToSwimlane}>
                      <SelectTrigger className="w-full bg-white dark:bg-zinc-800">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {swimlanes.map((col) => (
                          <SelectItem key={col.key} value={col.key}>
                            {col.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Priority</Label>
                    {detail?.parentId ? (
                      <p className="text-sm text-muted-foreground">Inherited from parent</p>
                    ) : (
                      <PrioritySelect
                        value={(current?.priority ?? 0) as TicketPriority}
                        onChange={(p) => patch({ priority: p })}
                        className="w-full"
                      />
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Start date</Label>
                    <Input
                      type="date"
                      value={detail?.startDate ? detail.startDate.slice(0, 10) : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        void patch({ startDate: val || null });
                      }}
                      className="bg-white dark:bg-zinc-800"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Due date</Label>
                    <Input
                      type="date"
                      value={detail?.dueDate ? detail.dueDate.slice(0, 10) : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        void patch({ dueDate: val || null });
                      }}
                      className="bg-white dark:bg-zinc-800"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <MarkdownEditor
                    value={description}
                    onChange={setDescription}
                    rows={10}
                    placeholder="Add a description… Markdown supported."
                    className="min-h-[200px] bg-white dark:bg-zinc-800"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Parent ticket</Label>
                  <TicketSelect
                    tickets={otherTickets}
                    value={detail?.parentId}
                    onChange={(id) => patch({ parentId: id ?? null })}
                    allowNone
                    noneLabel="No parent"
                    placeholder="No parent"
                    className="w-full"
                  />
                  {detail?.parent && (
                    <p className="text-xs text-muted-foreground">Parent: {detail.parent.title}</p>
                  )}
                </div>

                {detail?.parentId ? (
                  <p className="text-xs text-muted-foreground">Epic is inherited from the parent ticket.</p>
                ) : current?.type !== 'epic' ? (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Epic</Label>
                    <TicketSelect
                      tickets={epicTickets.filter((t) => t.id !== ticket?.id)}
                      value={detail?.epicId ?? undefined}
                      onChange={(id) => patch({ epicId: id ?? null })}
                      allowNone
                      noneLabel="No epic"
                      placeholder="No epic"
                      className="w-full"
                    />
                  </div>
                ) : null}

                {detail?.parentId ? (
                  <p className="text-xs text-muted-foreground">Labels are inherited from the parent ticket.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Labels</Label>
                    <LabelPicker
                      labels={labels}
                      selectedIds={detail?.labelIds ?? []}
                      onToggle={toggleLabel}
                      onCreate={onCreateLabel}
                    />
                  </div>
                )}

                <Separator />

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Relationships</Label>
                  {detail && detail.relations.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {detail.relations.map((rel) => (
                        <div
                          key={rel.relationId}
                          className="flex items-center justify-between rounded-md border px-2 py-1 text-sm"
                        >
                          <span>
                            <span className="text-muted-foreground">
                              {RELATION_KINDS.find((k) => k.value === rel.kind)?.label}:{' '}
                            </span>
                            {rel.ticket.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => setDeletingRelation(rel.relationId)}
                            className="opacity-60 hover:opacity-100"
                            aria-label="Remove relationship"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <RelationKindSelect value={relationKind} onChange={setRelationKind} className="w-36" />
                    <TicketSelect
                      tickets={otherTickets}
                      value={relationTicketId}
                      onChange={setRelationTicketId}
                      placeholder="Select a ticket"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addRelation}
                      disabled={!relationTicketId}
                    >
                      Add
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Sub-issues</Label>
                  {detail && detail.children.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {detail.children.map((child) => (
                        <div key={child.id} className="rounded-md border px-2 py-1 text-sm">
                          {child.title}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      value={subTitle}
                      onChange={(e) => setSubTitle(e.target.value)}
                      placeholder="Add sub-issue…"
                      className="h-8"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || (e.key === 'Tab' && subTitle.trim())) {
                          e.preventDefault();
                          void addSubIssue();
                        }
                      }}
                    />
                    <Button type="button" size="sm" variant="outline" onClick={addSubIssue} disabled={!subTitle.trim()}>
                      <PlusIcon data-icon="inline-start" />
                      Add
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Badge variant="outline" className="w-fit text-sm font-normal">
                    {typeLabel}
                  </Badge>
                  <Badge variant="outline" className="w-fit text-sm font-normal">
                    {swimlaneLabel}
                  </Badge>
                  <div className="flex items-center gap-1.5">
                    <PriorityIcon priority={(current?.priority ?? 0) as TicketPriority} />
                    <span className="text-sm">
                      {PRIORITY_META[(current?.priority ?? 0) as TicketPriority]?.label}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 text-sm text-muted-foreground">
                  <p>{formatDate(detail?.startDate) ? `Start: ${formatDate(detail?.startDate)}` : 'No start date'}</p>
                  <p>{formatDate(detail?.dueDate) ? `Due: ${formatDate(detail?.dueDate)}` : 'No due date'}</p>
                </div>

                {detail?.description ? (
                  <Markdown content={detail.description} />
                ) : (
                  <p className="text-sm text-muted-foreground">No description.</p>
                )}

                {detail?.parentId ? null : detail?.labels?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.labels.map((label) => (
                      <LabelBadge key={label.id} label={label} />
                    ))}
                  </div>
                ) : null}

                <p className="text-sm">{detail?.parent ? `Parent: ${detail.parent.title}` : 'No parent'}</p>

                {detail?.parentId ? null : current?.type !== 'epic' ? (
                  <p className="text-sm">{detail?.epicId ? 'Part of an epic' : 'No epic'}</p>
                ) : null}

                <Separator />

                {detail && detail.relations.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {detail.relations.map((rel) => (
                      <div
                        key={rel.relationId}
                        className="rounded-md border px-2 py-1 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {RELATION_KINDS.find((k) => k.value === rel.kind)?.label}:{' '}
                        </span>
                        {rel.ticket.title}
                      </div>
                    ))}
                  </div>
                ) : null}

                <Separator />

                {detail && detail.children.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {detail.children.map((child) => (
                      <div key={child.id} className="rounded-md border px-2 py-1 text-sm">
                        {child.title}
                      </div>
                    ))}
                  </div>
                ) : null}

                <Separator />

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Workflow Runs</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!ticket) return;
                            toast.promise(api.startRun(ticket.id), {
                              loading: 'Starting workflow run...',
                              success: () => {
                                api.listTicketRuns(ticket.id).then(setRuns).catch(() => undefined);
                                onChanged();
                                return 'Workflow run started';
                              },
                              error: (e: Error) => e.message,
                            });
                          }}
                          className="h-7 text-xs"
                        >
                          <PlayIcon data-icon="inline-start" />
                          Run workflow
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Execute the workflow for this ticket</TooltipContent>
                    </Tooltip>
                  </div>
                  {runsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading...</p>
                  ) : runs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No runs yet.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {runs.map((run) => {
                        const STATUS_VARIANT: Record<string, 'default' | 'destructive' | 'outline' | 'secondary' | 'success' | 'warning' | 'info'> = {
                          created: 'outline',
                          queued: 'outline',
                          running: 'info',
                          waiting: 'warning',
                          completed: 'success',
                          failed: 'destructive',
                          cancelled: 'outline',
                        };
                        return (
                          <div key={run.id} className="flex flex-col rounded-md border">
                            <div className="flex items-center px-2.5 py-1.5 gap-2">
                              <button
                                type="button"
                                onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                                className="flex flex-1 items-center justify-between text-left hover:bg-muted/30 min-w-0"
                              >
                                <div className="flex items-center gap-2 text-xs">
                                  <HistoryIcon className="size-3 text-muted-foreground" />
                                  <span className="font-medium">{run.workflowName}</span>
                                  <Badge variant={STATUS_VARIANT[run.status] ?? 'outline'} className="h-4 px-1 text-[10px]">
                                    {run.status}
                                  </Badge>
                                </div>
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(run.createdAt).toLocaleString()}
                                </span>
                              </button>
                              {ACTIVE_RUN_STATUSES.has(run.status) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[10px] text-destructive border-destructive hover:bg-destructive/10 shrink-0"
                                      onClick={async () => {
                                        try {
                                          await api.cancelRun(run.id);
                                          toast.success('Run cancelled');
                                          api.listTicketRuns(ticket!.id).then(setRuns).catch(() => undefined);
                                          onChanged();
                                        } catch (e) {
                                          toast.error((e as Error).message);
                                        }
                                      }}
                                    >
                                      <XCircleIcon data-icon="inline-start" />
                                      Cancel
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Cancel this run</TooltipContent>
                                </Tooltip>
                              )}
                              {run.status === 'waiting' && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[10px] text-green-600 border-green-600 hover:bg-green-600/10 shrink-0"
                                      onClick={async () => {
                                        try {
                                          const detail = await api.getRun(run.id);
                                          const waitingNode = detail.nodes.find((n) => n.status === 'waiting');
                                          if (!waitingNode) {
                                            toast.error('No waiting approval node found');
                                            return;
                                          }
                                          await api.approveRun(run.id, waitingNode.nodeKey);
                                          toast.success('Approved — resuming workflow');
                                          api.listTicketRuns(ticket!.id).then(setRuns).catch(() => undefined);
                                          onChanged();
                                        } catch (e) {
                                          toast.error((e as Error).message);
                                        }
                                      }}
                                    >
                                      <CheckCircle2Icon data-icon="inline-start" />
                                      Approve
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Approve the waiting node and resume the run</TooltipContent>
                                </Tooltip>
                              )}
                              {(run.status === 'failed' || run.status === 'cancelled') && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-6 px-2 text-[10px] text-amber-600 border-amber-600 hover:bg-amber-600/10 shrink-0"
                                      onClick={async () => {
                                        try {
                                          await api.retryRun(run.id);
                                          toast.success('Run retrying');
                                          api.listTicketRuns(ticket!.id).then(setRuns).catch(() => undefined);
                                          onChanged();
                                        } catch (e) {
                                          toast.error((e as Error).message);
                                        }
                                      }}
                                    >
                                      <RefreshCwIcon data-icon="inline-start" />
                                      Retry
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Retry this run</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            {expandedRunId === run.id && (
                              <div className="border-t px-2.5 py-2">
                                <RunLogViewer runId={run.id} compact maxHeight="250px" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
        {isEditing ? (
          <SheetFooter className="flex items-center justify-between border-t bg-card">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setDeletingTicket(true)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                <TrashIcon className="size-4" />
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
            <Button onClick={handleSaveAndClose}>
              Save changes
            </Button>
          </SheetFooter>
        ) : (
          <SheetFooter className="flex items-center justify-between border-t bg-card">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => setViewMode('edit')}>
              <SquarePenIcon data-icon="inline-start" />
              Edit
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>

    <ConfirmDialog
      open={deletingRelation !== null}
      onOpenChange={(open) => { if (!open) setDeletingRelation(null); }}
      title="Remove relation"
      description="Are you sure you want to remove this ticket relation?"
      confirmLabel="Remove"
      onConfirm={confirmRemoveRelation}
    />

    <ConfirmDialog
      open={deletingTicket}
      onOpenChange={setDeletingTicket}
      title="Delete ticket"
      description="Are you sure you want to permanently delete this ticket? This action cannot be undone."
      confirmLabel="Delete"
      onConfirm={confirmDeleteTicket}
    />

    {ticket && (
      <UpdateTicketAiModal
        open={updateAiModalOpen}
        onOpenChange={setUpdateAiModalOpen}
        ticketId={ticket.id}
        ticketTitle={current?.title ?? ''}
        ticketDescription={current?.description ?? ''}
        ticketType={current?.type ?? 'feature'}
        ticketPriority={current?.priority ?? 0}
        onApplied={() => {
          refetch();
          onChanged();
          setViewMode('view');
        }}
      />
    )}
  </>
  );
}
