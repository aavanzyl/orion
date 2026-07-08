import { useEffect, useMemo, useState } from 'react';
import { BarChart3Icon } from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type RunAnalytics } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';

const DAY_RANGES = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: '0' },
];

export function AnalyticsPage() {
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState<string>('all');
  const [days, setDays] = useState('30');
  const [analytics, setAnalytics] = useState<RunAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const params: { projectId?: string; days?: number } = {};
      if (projectId && projectId !== 'all') params.projectId = projectId;
      const d = parseInt(days, 10);
      if (d > 0) params.days = d;
      const result = await api.getAnalytics(params);
      setAnalytics(result);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [projectId, days]);

  const chartData = useMemo(() => {
    if (!analytics?.runsByDay) return [];
    return analytics.runsByDay.map((d) => ({
      date: d.date,
      runs: d.count,
      cost: Math.round(d.costUsd * 10000) / 10000,
    }));
  }, [analytics]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Aggregated metrics: success rate, cost trends, breakdowns.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3 border-b px-6 py-3">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAY_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : loading ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : !analytics ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <BarChart3Icon className="size-8 text-muted-foreground" />
            <p className="text-muted-foreground">No data to display.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">Success Rate</div>
                <div className="text-2xl font-bold">{analytics.successRate}%</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">Total Runs</div>
                <div className="text-2xl font-bold">{analytics.totalRuns}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">Total Cost</div>
                <div className="text-2xl font-bold">${analytics.totalCostUsd.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">{analytics.totalTokens.toLocaleString()} tokens</div>
              </div>
            </div>

            {chartData.length > 0 && (
              <div className="rounded-lg border p-4">
                <h3 className="mb-4 text-sm font-medium">Runs per Day</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip />
                    <Bar dataKey="runs" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {chartData.length > 0 && (
              <div className="rounded-lg border p-4">
                <h3 className="mb-4 text-sm font-medium">Cost over Time (USD)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip />
                    <Line type="monotone" dataKey="cost" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              {analytics.byProject.length > 0 && (
                <div className="rounded-lg border p-4">
                  <h3 className="mb-3 text-sm font-medium">By Project</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 font-medium">Project</th>
                        <th className="py-2 font-medium">Runs</th>
                        <th className="py-2 font-medium">Success</th>
                        <th className="py-2 font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.byProject.map((p) => (
                        <tr key={p.projectId} className="border-b last:border-0">
                          <td className="py-2">{p.name}</td>
                          <td className="py-2">{p.runs}</td>
                          <td className="py-2">{p.successRate}%</td>
                          <td className="py-2">${p.costUsd.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {analytics.byWorkflow.length > 0 && (
                <div className="rounded-lg border p-4">
                  <h3 className="mb-3 text-sm font-medium">By Workflow</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 font-medium">Workflow</th>
                        <th className="py-2 font-medium">Runs</th>
                        <th className="py-2 font-medium">Success</th>
                        <th className="py-2 font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.byWorkflow.map((w) => (
                        <tr key={w.workflow} className="border-b last:border-0">
                          <td className="py-2">{w.workflow}</td>
                          <td className="py-2">{w.runs}</td>
                          <td className="py-2">{w.successRate}%</td>
                          <td className="py-2">${w.costUsd.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
