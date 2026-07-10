import { useEffect, useMemo, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type {
  BoardSwimlane,
  Label as LabelModel,
  Ticket,
  TicketPriority,
  TicketRelationKind,
  UpdateTicketInput,
} from '@orion/models';
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
import { MarkdownEditor } from '@/components/markdown-editor';
import { api } from '@/lib/api';
import { useTicketDetail } from './hooks';
import { PrioritySelect } from './priority';
import { LabelPicker } from './label-picker';
import { RELATION_KINDS, RelationKindSelect, TicketSelect } from './ticket-picker';

interface TicketSheetProps {
  ticket: Ticket | null;
  projectId: string | null;
  labels: LabelModel[];
  tickets: Ticket[];
  swimlanes: BoardSwimlane[];
  onCreateLabel: (name: string, color: string) => Promise<void>;
  onClose: () => void;
  onChanged: () => void;
}

export function TicketSheet({
  ticket,
  projectId,
  labels,
  tickets,
  swimlanes,
  onCreateLabel,
  onClose,
  onChanged,
}: TicketSheetProps) {
  const { detail, refetch } = useTicketDetail(ticket?.id ?? null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [relationKind, setRelationKind] = useState<TicketRelationKind>('blocks');
  const [relationTicketId, setRelationTicketId] = useState<string | undefined>();

  const current = detail ?? ticket;

  useEffect(() => {
    setTitle(current?.title ?? '');
    setDescription(current?.description ?? '');
  }, [current?.id]);

  useEffect(() => {
    if (detail) setDescription(detail.description);
  }, [detail?.id]);

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

  return (
    <Sheet open={!!ticket} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="sr-only">Ticket details</SheetTitle>
          <div className="flex items-center gap-2">
            {current?.displayKey && (
              <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                {current.displayKey}
              </Badge>
            )}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== current?.title && patch({ title: title.trim() })}
              className="flex-1 border-none px-0 text-base font-semibold shadow-none focus-visible:ring-0"
            />
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-4 pb-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Swimlane</Label>
                <Select value={current?.swimlane} onValueChange={moveToSwimlane}>
                  <SelectTrigger className="w-full">
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
                <PrioritySelect
                  value={(current?.priority ?? 0) as TicketPriority}
                  onChange={(p) => patch({ priority: p })}
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <MarkdownEditor
                value={description}
                onChange={setDescription}
                rows={42}
                placeholder="Add a description… Markdown supported."
              />

            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Labels</Label>
              <LabelPicker
                labels={labels}
                selectedIds={detail?.labelIds ?? []}
                onToggle={toggleLabel}
                onCreate={onCreateLabel}
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

            <Separator />

            <div className="flex flex-col gap-2">
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
                        onClick={() => removeRelation(rel.relationId)}
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

            <div className="flex flex-col gap-2">
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
                    if (e.key === 'Enter') {
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
          </div>
        </ScrollArea>
        <SheetFooter className="border-t bg-card">
          <Button onClick={handleSaveAndClose}>
            Save changes
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
