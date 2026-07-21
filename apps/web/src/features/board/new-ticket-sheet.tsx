import { useEffect, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import type {
  AgentTicketPreviewResponse,
  BoardSwimlane,
  CreateTicketInput,
  Label as LabelModel,
  NewTicketRelation,
  Ticket,
  TicketPriority,
  TicketRelationKind,
  TicketType,
} from '@orion/models';
import { ALL_DEFAULT_TICKET_TYPES } from '@orion/models';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { MarkdownEditor } from '@/components/markdown-editor';
import { PrioritySelect } from './priority';
import { LabelPicker } from './label-picker';
import { RELATION_KINDS, RelationKindSelect, TicketSelect } from './ticket-picker';

type CreateInput = Omit<CreateTicketInput, 'projectId'>;

interface NewTicketSheetProps {
  swimlanes: BoardSwimlane[];
  labels: LabelModel[];
  tickets: Ticket[];
  epicTickets: Ticket[];
  projectId: string | null;
  ticketTypes?: { value: string; label: string }[];
  prefill?: AgentTicketPreviewResponse | null;
  onPrefillConsumed?: () => void;
  triggerLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultSwimlane?: string;
  onCreateLabel: (name: string, color: string) => Promise<void>;
  onCreate: (input: CreateInput) => Promise<void>;
}

export function NewTicketSheet({
  swimlanes,
  labels,
  tickets,
  epicTickets,
  projectId,
  ticketTypes,
  prefill,
  onPrefillConsumed,
  triggerLabel = 'New ticket',
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultSwimlane,
  onCreateLabel,
  onCreate,
}: NewTicketSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (o: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(o);
    } else {
      setInternalOpen(o);
    }
  };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [swimlane, setSwimlane] = useState<string | undefined>(defaultSwimlane ?? swimlanes[0]?.key);
  const [priority, setPriority] = useState<TicketPriority>(0);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [parentId, setParentId] = useState<string | undefined>();
  const [ticketType, setTicketType] = useState<TicketType>('feature');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [relations, setRelations] = useState<NewTicketRelation[]>([]);
  const [relationKind, setRelationKind] = useState<TicketRelationKind>('blocks');
  const [relationTicketId, setRelationTicketId] = useState<string | undefined>();
  const [epicId, setEpicId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSwimlane(defaultSwimlane ?? swimlanes[0]?.key);
  }, [open, swimlanes, defaultSwimlane]);

  useEffect(() => {
    if (!open || !prefill) return;
    setTitle(prefill.title);
    setDescription(prefill.description);
    setTicketType(prefill.type as TicketType);
    setPriority(prefill.priority as TicketPriority);
    if (prefill.labels.length > 0) {
      const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
      const ids = prefill.labels
        .map((n) => byName.get(n.toLowerCase()))
        .filter((id): id is string => id !== undefined);
      if (ids.length > 0) setLabelIds(ids);
    }
    onPrefillConsumed?.();
  }, [open, prefill]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setSwimlane(swimlanes[0]?.key);
    setPriority(0);
    setLabelIds([]);
    setParentId(undefined);
    setTicketType('feature');
    setStartDate('');
    setDueDate('');
    setRelations([]);
    setRelationKind('blocks');
    setRelationTicketId(undefined);
    setEpicId(null);
  };

  const toggleLabel = (id: string) =>
    setLabelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addRelation = () => {
    if (!relationTicketId) return;
    setRelations((prev) => [...prev, { kind: relationKind, ticketId: relationTicketId }]);
    setRelationTicketId(undefined);
  };

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        swimlane,
        priority,
        labelIds,
        parentId,
        relations,
        type: ticketType,
        startDate: startDate || undefined,
        dueDate: dueDate || undefined,
        epicId: ticketType !== 'epic' ? epicId : null,
      });
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const ticketTitleStr = (id: string) => tickets.find((t) => t.id === id)?.title ?? id;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { reset(); setOpen(false); } else setOpen(true); }}>
      {!isControlled && (
        <SheetTrigger asChild>
          <Button>
            <PlusIcon data-icon="inline-start" />
            {triggerLabel}
          </Button>
        </SheetTrigger>
      )}
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Create ticket</SheetTitle>
          <SheetDescription>Add work for an agent to pick up.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-4 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticket-title" className="text-xs text-muted-foreground">Title</Label>
              <Input
                id="ticket-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fix flaky login test"
                className="bg-white dark:bg-zinc-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={ticketType} onValueChange={(v) => setTicketType(v as TicketType)}>
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
                <Select value={swimlane} onValueChange={setSwimlane}>
                  <SelectTrigger className="w-full bg-white dark:bg-zinc-800">
                    <SelectValue placeholder="Select a swimlane" />
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
                <PrioritySelect value={priority} onChange={setPriority} className="w-full" />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="ticket-start-date" className="text-xs text-muted-foreground">Start date</Label>
                <Input
                  id="ticket-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-white dark:bg-zinc-800"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="ticket-due-date" className="text-xs text-muted-foreground">Due date</Label>
                <Input
                  id="ticket-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="bg-white dark:bg-zinc-800"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticket-description" className="text-xs text-muted-foreground">Description</Label>
              <MarkdownEditor
                id="ticket-description"
                value={description}
                onChange={setDescription}
                rows={36}
                placeholder="Context, acceptance criteria, links… Markdown supported."
                className="bg-white dark:bg-zinc-800"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Parent ticket</Label>
              <TicketSelect
                tickets={tickets}
                value={parentId}
                onChange={setParentId}
                allowNone
                noneLabel="No parent"
                placeholder="No parent"
                className="w-full"
              />
            </div>

            {parentId ? (
              <p className="text-xs text-muted-foreground">Epic, labels and priority are inherited from the parent ticket.</p>
            ) : (
              <>
                {ticketType !== 'epic' && (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">Epic</Label>
                    <TicketSelect
                      tickets={epicTickets.filter((t) => t.id !== parentId)}
                      value={epicId ?? undefined}
                      onChange={(id) => setEpicId(id ?? null)}
                      allowNone
                      noneLabel="No epic"
                      placeholder="No epic"
                      className="w-full"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground">Labels</Label>
                  <LabelPicker
                    labels={labels}
                    selectedIds={labelIds}
                    onToggle={toggleLabel}
                    onCreate={onCreateLabel}
                  />
                </div>
              </>
            )}

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Relationships</Label>
              {relations.length > 0 && (
                <div className="flex flex-col gap-1">
                  {relations.map((rel, i) => (
                    <div
                      key={`${rel.kind}-${rel.ticketId}-${i}`}
                      className="flex items-center justify-between rounded-md border px-2 py-1 text-sm"
                    >
                      <span>
                        <span className="text-muted-foreground">
                          {RELATION_KINDS.find((k) => k.value === rel.kind)?.label}:{' '}
                        </span>
                        {ticketTitleStr(rel.ticketId)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRelations((prev) => prev.filter((_, idx) => idx !== i))}
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
                  tickets={tickets}
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
          </div>
        </ScrollArea>

        <SheetFooter className="flex items-center justify-between border-t">
          <Button variant="ghost" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !title.trim()}>
            Create
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
