import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BotIcon,
  ClipboardCheckIcon,
  GaugeIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  EvaluationRating,
  EvaluationSummary,
  RunEvaluation,
} from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type RunListItem } from '@/lib/api';
import { useProjectContext } from '@/lib/use-project-context';

const DAY_RANGES = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: '0' },
];

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-300',
  running: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  waiting: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
};

interface ReviewState {
  run: RunListItem;
  rating: EvaluationRating;
  score: string;
  labels: string;
  comment: string;
}

export function EvaluationsPage() {
  const { projectId: globalProjectId } = useProjectContext();
  const [days, setDays] = useState('30');
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [evaluations, setEvaluations] = useState<RunEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = globalProjectId || undefined;
      const d = parseInt(days, 10);
      const [summaryResult, runsResult, evalResult] = await Promise.all([
        api.getEvaluationSummary({ projectId: scoped, days: d > 0 ? d : undefined }),
        api.listRuns({ projectId: scoped, limit: 30 }),
        scoped ? api.listProjectEvaluations(scoped, 200) : Promise.resolve<RunEvaluation[]>([]),
      ]);
      setSummary(summaryResult);
      setRuns(runsResult);
      setEvaluations(evalResult);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [globalProjectId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const evalCountByRun = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of evaluations) map.set(e.runId, (map.get(e.runId) ?? 0) + 1);
    return map;
  }, [evaluations]);

  const quickRate = useCallback(
    async (run: RunListItem, rating: EvaluationRating) => {
      try {
        await api.createEvaluation(run.id, { rating, evaluator: 'human' });
        toast.success(`Marked run ${rating}`);
        void load();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [load],
  );

  const submitReview = useCallback(async () => {
    if (!review) return;
    const score = review.score.trim() === '' ? undefined : Number(review.score);
    if (score !== undefined && (Number.isNaN(score) || score < 0 || score > 1)) {
      toast.error('Score must be a number between 0 and 1.');
      return;
    }
    setSaving(true);
    try {
      await api.createEvaluation(review.run.id, {
        rating: review.rating,
        score,
        evaluator: 'human',
        labels: review.labels
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean),
        comment: review.comment.trim() || undefined,
      });
      toast.success('Evaluation saved');
      setReview(null);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [review, load]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-4 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Evaluations</h1>
          <p className="text-sm text-muted-foreground">
            Rate runs to build the feedback loop that improves your agents.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3 border-b px-6 py-3">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : loading ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {summary && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <SummaryCard label="Evaluations" value={String(summary.totalEvaluations)} />
                <SummaryCard
                  label="Positive"
                  value={String(summary.positive)}
                  tone="text-emerald-600 dark:text-emerald-400"
                />
                <SummaryCard
                  label="Negative"
                  value={String(summary.negative)}
                  tone="text-red-600 dark:text-red-400"
                />
                <SummaryCard
                  label="Avg score"
                  value={summary.averageScore != null ? summary.averageScore.toFixed(2) : '—'}
                />
              </div>
            )}

            {summary && summary.topLabels.length > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium">Top labels</h3>
                <div className="flex flex-wrap gap-2">
                  {summary.topLabels.map((l) => (
                    <Badge key={l.label} variant="secondary">
                      {l.label}
                      <span className="ml-1.5 text-muted-foreground">{l.count}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <BotIcon className="size-4" />
                Agent scorecards
              </h3>
              {!summary || summary.byAgent.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No agent telemetry yet. Run a workflow to populate metrics.
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Runs</TableHead>
                        <TableHead>Success</TableHead>
                        <TableHead>Avg time</TableHead>
                        <TableHead>Tokens</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Feedback</TableHead>
                        <TableHead>Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.byAgent.map((a) => (
                        <TableRow key={a.agentId}>
                          <TableCell className="font-medium">{a.agentId}</TableCell>
                          <TableCell className="text-muted-foreground">{a.model ?? '—'}</TableCell>
                          <TableCell>{a.nodeRuns}</TableCell>
                          <TableCell>{a.successRate}%</TableCell>
                          <TableCell>{formatDuration(a.avgDurationMs ?? undefined)}</TableCell>
                          <TableCell>{a.totalTokens.toLocaleString()}</TableCell>
                          <TableCell>${a.costUsd.toFixed(2)}</TableCell>
                          <TableCell>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              +{a.positive}
                            </span>{' '}
                            <span className="text-red-600 dark:text-red-400">-{a.negative}</span>
                          </TableCell>
                          <TableCell>{a.avgScore != null ? a.avgScore.toFixed(2) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <ClipboardCheckIcon className="size-4" />
                Recent runs to review
              </h3>
              {runs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No runs found.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {runs.map((run) => {
                    const count = evalCountByRun.get(run.id) ?? 0;
                    return (
                      <li key={run.id} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">
                              {run.ticketTitle ?? run.workflowName}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                                STATUS_STYLES[run.status] ?? 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {run.status}
                            </span>
                            {count > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {count} eval{count > 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {run.workflowName} · {formatDuration(run.durationMs)} · $
                            {(run.costUsd ?? 0).toFixed(2)} ·{' '}
                            {(run.totalTokens ?? 0).toLocaleString()} tokens
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-emerald-600 hover:text-emerald-600"
                                aria-label="Mark positive"
                                onClick={() => quickRate(run, 'positive')}
                              >
                                <ThumbsUpIcon />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Quick rate as positive</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-red-600 hover:text-red-600"
                                aria-label="Mark negative"
                                onClick={() => quickRate(run, 'negative')}
                              >
                                <ThumbsDownIcon />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Quick rate as negative</TooltipContent>
                          </Tooltip>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setReview({
                                run,
                                rating: 'positive',
                                score: '',
                                labels: '',
                                comment: '',
                              })
                            }
                          >
                            <GaugeIcon data-icon="inline-start" />
                            Review
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>

      <Dialog open={review != null} onOpenChange={(open) => !open && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review run</DialogTitle>
            <DialogDescription>
              {review?.run.ticketTitle ?? review?.run.workflowName}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Rating</Label>
                <div className="flex gap-2">
                  {(['positive', 'neutral', 'negative'] as EvaluationRating[]).map((r) => (
                    <Button
                      key={r}
                      type="button"
                      variant={review.rating === r ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setReview({ ...review, rating: r })}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Score (0–1, optional)</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={review.score}
                  onChange={(e) => setReview({ ...review, score: e.target.value })}
                  placeholder="0.8"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Labels (comma separated)</Label>
                <Input
                  value={review.labels}
                  onChange={(e) => setReview({ ...review, labels: e.target.value })}
                  placeholder="wrong-approach, flaky-test"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Comment</Label>
                <Textarea
                  value={review.comment}
                  onChange={(e) => setReview({ ...review, comment: e.target.value })}
                  placeholder="What went well or badly, and why…"
                  className="min-h-20 text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReview(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitReview} disabled={saving}>
              Save evaluation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}
