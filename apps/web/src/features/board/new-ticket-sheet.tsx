import { useEffect, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import type {
  BoardSwimlane,
  CreateTicketInput,
  Label as LabelModel,
  NewTicketRelation,
  Ticket,
  TicketPriority,
  TicketRelationKind,
} from '@orion/models';
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
import { MarkdownEditor } from '@/components/markdown-editor';
import { PrioritySelect } from './priority';
import { LabelPicker } from './label-picker';
import { RELATION_KINDS, RelationKindSelect, TicketSelect } from './ticket-picker';

type CreateInput = Omit<CreateTicketInput, 'projectId'>;

interface NewTicketSheetProps {
  swimlanes: BoardSwimlane[];
  labels: LabelModel[];
  tickets: Ticket[];
  onCreateLabel: (name: string, color: string) => Promise<void>;
  onCreate: (input: CreateInput) => Promise<void>;
}

export function NewTicketSheet({
  swimlanes,
  labels,
  tickets,
  onCreateLabel,
  onCreate,
}: NewTicketSheetProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [swimlane, setSwimlane] = useState<string | undefined>(swimlanes[0]?.key);
  const [priority, setPriority] = useState<TicketPriority>(0);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [parentId, setParentId] = useState<string | undefined>();
  const [relations, setRelations] = useState<NewTicketRelation[]>([]);
  const [relationKind, setRelationKind] = useState<TicketRelationKind>('blocks');
  const [relationTicketId, setRelationTicketId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSwimlane((prev) => prev ?? swimlanes[0]?.key);
  }, [open, swimlanes]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setSwimlane(swimlanes[0]?.key);
    setPriority(0);
    setLabelIds([]);
    setParentId(undefined);
    setRelations([]);
    setRelationKind('blocks');
    setRelationTicketId(undefined);
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
      });
      reset();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const ticketTitle = (id: string) => tickets.find((t) => t.id === id)?.title ?? id;

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : (setOpen(false), reset()))}>
      <SheetTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          New ticket
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Create ticket</SheetTitle>
          <SheetDescription>Add work for an agent to pick up.</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-title">Title</Label>
              <Input
                id="ticket-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fix flaky login test"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label>Swimlane</Label>
                <Select value={swimlane} onValueChange={setSwimlane}>
                  <SelectTrigger className="w-full">
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
              <div className="flex flex-col gap-2">
                <Label>Priority</Label>
                <PrioritySelect value={priority} onChange={setPriority} className="w-full" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ticket-description">Description</Label>
              <MarkdownEditor
                id="ticket-description"
                value={description}
                onChange={setDescription}
                rows={12}
                placeholder="Context, acceptance criteria, links… Markdown supported."
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Labels</Label>
              <LabelPicker
                labels={labels}
                selectedIds={labelIds}
                onToggle={toggleLabel}
                onCreate={onCreateLabel}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Parent ticket</Label>
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

            <div className="flex flex-col gap-2">
              <Label>Relationships</Label>
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
                        {ticketTitle(rel.ticketId)}
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

        <SheetFooter className="border-t">
          <Button onClick={submit} disabled={submitting}>
            Create
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
