import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarIcon, ChevronRightIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Epic, Ticket } from '@orion/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';
import { cn } from '@/lib/utils';
import { EpicPicker } from './epic-picker';

type ZoomLevel = 'month' | 'quarter' | 'year';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const DAY_WIDTH: Record<ZoomLevel, number> = { month: 6, quarter: 1.5, year: 0.4 };
const MONTH_HEADER_HEIGHT = 50;
const TICKET_ROW_HEIGHT = 44;
const LABEL_WIDTH = 260;

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function isPastDue(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface EpicSpan {
  epic: Epic;
  tickets: Ticket[];
  earliest: Date;
  latest: Date;
}

function buildEpicSpans(epics: Epic[], tickets: Ticket[]): EpicSpan[] {
  const ticketMap = new Map<string, Ticket[]>();
  for (const t of tickets) {
    if (!t.epicId || !t.startDate || !t.dueDate) continue;
    const bucket = ticketMap.get(t.epicId) ?? ticketMap.set(t.epicId, []).get(t.epicId)!;
    bucket.push(t);
  }
  return epics
    .map((epic) => {
      const epicTickets = ticketMap.get(epic.id) ?? [];
      if (epicTickets.length === 0) return null;
      let earliest = new Date(epicTickets[0].startDate!);
      let latest = new Date(epicTickets[0].dueDate!);
      for (const t of epicTickets) {
        const start = new Date(t.startDate!);
        const end = new Date(t.dueDate!);
        if (start < earliest) earliest = start;
        if (end > latest) latest = end;
      }
      return { epic, tickets: epicTickets, earliest, latest };
    })
    .filter((s): s is EpicSpan => s !== null)
    .sort((a, b) => a.earliest.getTime() - b.earliest.getTime());
}

function generateMonthHeaders(timelineStart: Date, totalDays: number) {
  const headers: { label: string; left: number; width: number }[] = [];
  const cursor = new Date(timelineStart);
  const end = new Date(timelineStart.getTime() + totalDays * MS_PER_DAY);

  while (cursor <= end) {
    const monthStart = startOfMonth(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const left = daysBetween(timelineStart, monthStart);
    const daysInMonth = daysBetween(monthStart, monthEnd) + 1;
    const label = cursor.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    headers.push({ label, left, width: daysInMonth });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return headers;
}

function generateWeekHeaders(timelineStart: Date, totalDays: number) {
  const headers: { label: string; left: number }[] = [];
  const end = new Date(timelineStart.getTime() + totalDays * MS_PER_DAY);

  const cursor = new Date(timelineStart);
  const dayOfWeek = cursor.getDay();
  const daysUntilMonday = dayOfWeek === 1 ? 0 : dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  cursor.setDate(cursor.getDate() + daysUntilMonday);

  while (cursor <= end) {
    const left = daysBetween(timelineStart, cursor);
    const label = cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    headers.push({ label, left });
    cursor.setDate(cursor.getDate() + 7);
  }

  return headers;
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 pt-20 text-muted-foreground">
      <CalendarIcon className="size-10 opacity-30" />
      <p>No epics with date ranges yet.</p>
      <p className="text-sm">Set a ticket type to Epic and add start/due dates to see it here.</p>
    </div>
  );
}

export function TimelinePage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomLevel>('month');
  const scrollRef = useRef<HTMLDivElement>(null);

  const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);

  const [createEpicOpen, setCreateEpicOpen] = useState(false);
  const [createEpicTitle, setCreateEpicTitle] = useState('');
  const [createEpicColor, setCreateEpicColor] = useState('#7c3aed');

  const [editEpicOpen, setEditEpicOpen] = useState(false);
  const [editEpicId, setEditEpicId] = useState<string | null>(null);
  const [editEpicTitle, setEditEpicTitle] = useState('');
  const [editEpicColor, setEditEpicColor] = useState('#7c3aed');

  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    api
      .getTimeline(projectId)
      .then((data) => {
        setTickets(data.tickets);
        setEpics(data.epics);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const refetch = useCallback(() => {
    if (!projectId) return;
    api.getTimeline(projectId)
      .then((data) => {
        setTickets(data.tickets);
        setEpics(data.epics);
      })
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  const handleCreateEpic = async () => {
    if (!projectId || !createEpicTitle.trim()) return;
    try {
      await api.createEpic(projectId, { title: createEpicTitle.trim(), color: createEpicColor });
      setCreateEpicTitle('');
      setCreateEpicColor('#7c3aed');
      setCreateEpicOpen(false);
      refetch();
      toast.success('Epic created');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleEditEpic = async () => {
    if (!editEpicId || !editEpicTitle.trim()) return;
    try {
      await api.updateEpic(editEpicId, { title: editEpicTitle.trim(), color: editEpicColor });
      setEditEpicOpen(false);
      setEditEpicId(null);
      refetch();
      toast.success('Epic updated');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleColorChange = async (epicId: string, color: string) => {
    try {
      await api.updateEpic(epicId, { color });
      setEpics((prev) => prev.map((e) => (e.id === epicId ? { ...e, color } : e)));
      setColorPickerOpen(null);
      toast.success('Epic color updated');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const openEditEpic = (epic: Epic) => {
    setEditEpicId(epic.id);
    setEditEpicTitle(epic.title);
    setEditEpicColor(epic.color);
    setEditEpicOpen(true);
  };

  const timelineStart = useMemo(() => {
    if (tickets.length === 0) return new Date();
    const earliest = tickets.reduce((min, t) => {
      const d = t.startDate ? new Date(t.startDate) : new Date(t.createdAt);
      return d < min ? d : min;
    }, new Date());
    return startOfMonth(earliest);
  }, [tickets]);

  const dayWidth = DAY_WIDTH[zoom];

  const epicSpans = useMemo(
    () => buildEpicSpans(epics, tickets),
    [epics, tickets],
  );

  const epicTicketIds = useMemo(() => {
    const set = new Set<string>();
    for (const span of epicSpans) {
      for (const t of span.tickets) set.add(t.id);
    }
    return set;
  }, [epicSpans]);

  const ungroupedEpics = useMemo(
    () => tickets.filter((t) => t.startDate && t.dueDate && !epicTicketIds.has(t.id)),
    [tickets, epicTicketIds],
  );

  const maxEnd = useMemo(() => {
    let end = new Date();
    for (const t of tickets) {
      if (!t.dueDate) continue;
      const d = new Date(t.dueDate);
      if (d > end) end = d;
    }
    for (const span of epicSpans) {
      if (span.latest > end) end = span.latest;
    }
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    if (sixMonthsFromNow > end) end = sixMonthsFromNow;
    return end;
  }, [tickets, epicSpans]);

  const totalDays = daysBetween(timelineStart, maxEnd) + 1;
  const totalWidth = totalDays * dayWidth;

  const monthHeaders = useMemo(
    () => generateMonthHeaders(timelineStart, totalDays),
    [timelineStart, totalDays],
  );

  const weekHeaders = useMemo(
    () => generateWeekHeaders(timelineStart, totalDays),
    [timelineStart, totalDays],
  );

  const todayX = useMemo(() => {
    const now = new Date();
    return daysBetween(timelineStart, now) * dayWidth;
  }, [timelineStart, dayWidth]);

  const scrollToToday = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayX - scrollRef.current.clientWidth / 2);
    }
  }, [todayX]);

  const labelRowHeight = epicSpans.reduce((sum, s) => sum + 1 + s.tickets.length, 0) + ungroupedEpics.length;
  const totalHeight = MONTH_HEADER_HEIGHT + labelRowHeight * TICKET_ROW_HEIGHT + 4;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Timeline</h1>
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={projectsLoading ? 'Loading…' : 'Select a project'} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          {projectId && (
            <EpicPicker
              projectId={projectId}
              onChange={() => {
                if (projectId) {
                  api.getTimeline(projectId).then((data) => {
                    setTickets(data.tickets);
                    setEpics(data.epics);
                  });
                }
              }}
            />
          )}
          <div className="flex items-center rounded-md border bg-muted/30">
            {(['month', 'quarter', 'year'] as ZoomLevel[]).map((z) => (
              <Button
                key={z}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 rounded-sm px-3 text-xs capitalize',
                  zoom === z && 'bg-background shadow-sm',
                )}
                onClick={() => setZoom(z)}
              >
                {z}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={scrollToToday} className="h-7 text-xs">
            Today
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {!projectId ? (
          <p className="p-6 text-muted-foreground">Create or select a project to see its timeline.</p>
        ) : error ? (
          <p className="p-6 text-destructive">{error}</p>
        ) : loading ? (
          <TimelineSkeleton />
        ) : tickets.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex h-full">
            <div
              className="shrink-0 overflow-y-auto overflow-x-hidden border-r bg-card"
              style={{ width: LABEL_WIDTH }}
            >
              <div style={{ height: MONTH_HEADER_HEIGHT }} className="flex items-center justify-between border-b px-3">
                <span className="text-xs font-semibold text-muted-foreground">Epics</span>
                {projectId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setCreateEpicOpen(true)}
                  >
                    <PlusIcon className="mr-1 size-2.5" />
                    New
                  </Button>
                )}
              </div>
              <div className="flex flex-col">
                {epicSpans.map((span) => (
                  <div key={`epic-${span.epic.id}`}>
                    <div
                      className={cn(
                        'flex items-center gap-1.5 border-b px-3 text-xs font-semibold',
                        'cursor-pointer transition-colors hover:bg-muted/50',
                        selectedEpicId === span.epic.id && 'bg-accent/50',
                      )}
                      style={{ height: TICKET_ROW_HEIGHT }}
                      onClick={() => setSelectedEpicId(selectedEpicId === span.epic.id ? null : span.epic.id)}
                    >
                      <label
                        className="size-3 rounded-sm shrink-0 cursor-pointer"
                        style={{ backgroundColor: span.epic.color }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setColorPickerOpen(colorPickerOpen === span.epic.id ? null : span.epic.id);
                        }}
                      >
                        <input
                          type="color"
                          value={span.epic.color}
                          className="sr-only"
                          onChange={(e) => handleColorChange(span.epic.id, e.target.value)}
                        />
                      </label>
                      <span className="truncate">{span.epic.title}</span>
                      <button
                        type="button"
                        className="ml-auto shrink-0 rounded p-0.5 opacity-40 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditEpic(span.epic);
                        }}
                        aria-label={`Edit ${span.epic.title}`}
                      >
                        <PencilIcon className="size-2.5" />
                      </button>
                      <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                        {span.tickets.length}
                      </span>
                    </div>
                    {span.tickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="flex items-center border-b px-7 text-[0.6875rem]"
                        style={{ height: TICKET_ROW_HEIGHT }}
                      >
                        <ChevronRightIcon className="mr-1 size-2.5 shrink-0 text-muted-foreground/40" />
                        <span className="truncate">{ticket.title}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {ungroupedEpics.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex items-center border-b px-3 text-xs"
                    style={{ height: TICKET_ROW_HEIGHT }}
                  >
                    <span className="truncate">{ticket.title}</span>
                  </div>
                ))}
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-auto">
              <div className="relative" style={{ width: Math.max(totalWidth, 1), height: Math.max(totalHeight, 1) }}>
                {/* Month headers */}
                <div
                  className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur-sm"
                  style={{ height: MONTH_HEADER_HEIGHT }}
                >
                  {monthHeaders.map((h) => (
                    <div
                      key={h.label}
                      className="absolute top-0 flex items-center border-r px-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground"
                      style={{ left: h.left * dayWidth, width: h.width * dayWidth, height: MONTH_HEADER_HEIGHT }}
                    >
                      {h.label}
                    </div>
                  ))}
                  {weekHeaders.map((w) => (
                    <div
                      key={`wl-${w.label}`}
                      className="absolute bottom-0 flex items-end pb-0.5 px-1 text-[0.55rem] text-muted-foreground/40"
                      style={{ left: w.left * dayWidth, height: MONTH_HEADER_HEIGHT }}
                    >
                      {w.label}
                    </div>
                  ))}
                </div>

                {/* Today line */}
                {todayX > 0 && (
                  <div
                    className="absolute top-0 z-20 w-px bg-destructive"
                    style={{ left: todayX, height: totalHeight }}
                  >
                    <div className="absolute -top-1 -left-[3px] size-1.5 rounded-full bg-destructive" />
                  </div>
                )}

                {/* Week separator lines */}
                {weekHeaders.map((w) => (
                  <div
                    key={`wline-${w.label}`}
                    className="absolute top-0 z-0 border-l border-dashed border-border/25"
                    style={{ left: w.left * dayWidth, height: totalHeight }}
                  />
                ))}

                {/* Bars area */}
                <div className="relative" style={{ top: MONTH_HEADER_HEIGHT }}>
                  {epicSpans.map((span) => {
                    const spanLeft = daysBetween(timelineStart, span.earliest) * dayWidth;
                    const spanWidth = daysBetween(span.earliest, span.latest) * dayWidth;
                    const isDimmed = selectedEpicId !== null && selectedEpicId !== span.epic.id;
                    return (
                      <div key={`bars-epic-${span.epic.id}`} className={cn(isDimmed && 'opacity-30 transition-opacity')}>
                        {/* Epic header row */}
                        <div style={{ height: TICKET_ROW_HEIGHT }} className="relative">
                          <div
                            className="absolute top-0.5 h-6 rounded-md border opacity-40"
                            style={{
                              left: spanLeft,
                              width: Math.max(spanWidth, dayWidth * 2),
                              backgroundColor: span.epic.color,
                              borderColor: span.epic.color,
                            }}
                          />
                        </div>
                        {/* Epic ticket bars */}
                        {span.tickets.map((ticket) => {
                          const start = daysBetween(timelineStart, new Date(ticket.startDate!)) * dayWidth;
                          const width = Math.max(dayWidth, daysBetween(new Date(ticket.startDate!), new Date(ticket.dueDate!)) * dayWidth);
                          const pastDue = isPastDue(ticket.dueDate!);
                          return (
                            <div key={ticket.id} style={{ height: TICKET_ROW_HEIGHT }} className="relative">
                              <Link
                                to={`/?ticket=${ticket.id}`}
                                className={cn(
                                  'absolute top-0.5 flex h-6 items-center rounded-sm border px-1.5 text-[0.625rem] font-medium transition-colors hover:brightness-90',
                                  pastDue && 'border-destructive/40 bg-destructive/10 text-destructive',
                                )}
                                style={pastDue ? { left: start, width } : {
                                  left: start,
                                  width,
                                  backgroundColor: hexToRgba(span.epic.color, 0.12),
                                  borderColor: hexToRgba(span.epic.color, 0.4),
                                  color: span.epic.color,
                                }}
                                title={`${ticket.title}\n${new Date(ticket.startDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → ${new Date(ticket.dueDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                              >
                                <span className="truncate">{ticket.title}</span>
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* Ungrouped epic bars */}
                  {ungroupedEpics.map((ticket) => {
                    const start = daysBetween(timelineStart, new Date(ticket.startDate!)) * dayWidth;
                    const width = Math.max(dayWidth, daysBetween(new Date(ticket.startDate!), new Date(ticket.dueDate!)) * dayWidth);
                    const pastDue = isPastDue(ticket.dueDate!);
                    return (
                      <div key={ticket.id} style={{ height: TICKET_ROW_HEIGHT }} className="relative">
                        <Link
                          to={`/?ticket=${ticket.id}`}
                          className={cn(
                            'absolute top-0.5 flex h-6 items-center rounded-md border px-2 text-[0.625rem] font-medium transition-colors hover:brightness-95',
                            pastDue
                              ? 'border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10'
                              : 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10',
                          )}
                          style={{ left: start, width }}
                          title={`${ticket.title}\n${new Date(ticket.startDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → ${new Date(ticket.dueDate!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                        >
                          <span className="truncate">{ticket.title}</span>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <Dialog open={createEpicOpen} onOpenChange={setCreateEpicOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create epic</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input
                value={createEpicTitle}
                onChange={(e) => setCreateEpicTitle(e.target.value)}
                placeholder="e.g. Onboarding v2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateEpic();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={createEpicColor}
                  onChange={(e) => setCreateEpicColor(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border"
                />
                <span className="text-xs text-muted-foreground">{createEpicColor}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreateEpic} disabled={!createEpicTitle.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editEpicOpen} onOpenChange={setEditEpicOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit epic</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input
                value={editEpicTitle}
                onChange={(e) => setEditEpicTitle(e.target.value)}
                placeholder="Epic title"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleEditEpic();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editEpicColor}
                  onChange={(e) => setEditEpicColor(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border"
                />
                <span className="text-xs text-muted-foreground">{editEpicColor}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEditEpic} disabled={!editEpicTitle.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
