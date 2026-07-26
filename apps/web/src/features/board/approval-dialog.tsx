import { useState, useMemo, useEffect, useCallback } from 'react';
import { CheckCircle2Icon, ChevronDownIcon, FileIcon, Loader2Icon, XCircleIcon } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { toast } from 'sonner';
import type { RunNode, WorkflowRun } from '@orion/models';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

interface ApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  nodeKey: string;
  onResolved: () => void;
}

interface FileDiff {
  filename: string;
  header: string;
  hunks: string;
  additions: number;
  deletions: number;
}

function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const filePattern = /^diff --git a\/(.+) b\/(.+)$/m;
  const chunks = diff.split(/(?=^diff --git )/m);

  for (const chunk of chunks) {
    const match = chunk.match(filePattern);
    if (!match) continue;
    const filename = match[2] ?? match[1] ?? 'unknown';
    const headerLines: string[] = [];
    const hunkLines: string[] = [];
    let inHeader = true;
    let additions = 0;
    let deletions = 0;

    for (const line of chunk.split('\n')) {
      if (line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        headerLines.push(line);
        inHeader = true;
      } else if (line.startsWith('@@')) {
        inHeader = false;
        hunkLines.push(line);
      } else if (!inHeader) {
        hunkLines.push(line);
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
    }

    files.push({
      filename,
      header: headerLines.join('\n'),
      hunks: hunkLines.join('\n'),
      additions,
      deletions,
    });
  }

  return files;
}

export function ApprovalDialog({
  open,
  onOpenChange,
  runId,
  nodeKey,
  onResolved,
}: ApprovalDialogProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [nodes, setNodes] = useState<RunNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showFullDiff, setShowFullDiff] = useState(false);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const loadRun = useCallback(async () => {
    try {
      const detail = await api.getRun(runId);
      setRun(detail.run);
      setNodes(detail.nodes);

      if (detail.run.diff) {
        setSummaryLoading(true);
        api.summarizeRun(runId).then((r) => setSummary(r.summary)).catch(() => {}).finally(() => setSummaryLoading(false));
        api.getChangedFiles(runId).then(setFileContents).catch(() => {});
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (open) {
      setIsLoading(true);
      setRun(null);
      setNodes([]);
      setSummary('');
      setFileContents({});
      setExpandedFiles(new Set());
      setShowFullDiff(false);
      setShowRejectReason(false);
      setRejectReason('');
      loadRun();
    }
  }, [open, loadRun]);

  const files = useMemo(() => {
    if (!run?.diff) return [];
    return parseDiff(run.diff);
  }, [run?.diff]);

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  const isPending = isApproving || isRejecting;

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await api.approveRun(runId, nodeKey);
      toast.success('Approved — resuming workflow');
      onOpenChange(false);
      onResolved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    const reason = rejectReason.trim() || 'Rejected by human';
    setIsRejecting(true);
    try {
      await api.rejectRun(runId, nodeKey, reason);
      toast.success('Rejected — transitioning on failure');
      onOpenChange(false);
      onResolved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsRejecting(false);
    }
  };

  const hasDiff = run?.diff && run.diff.trim().length > 0;
  const wasRejected = nodes.find((n) => n.nodeKey === nodeKey)?.error === 'Rejected by human';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl md:min-w-[48rem] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Review Changes
            {wasRejected && (
              <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                Previously rejected
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Review the changes before approving or rejecting.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading run details...</span>
          </div>
        )}

        {!isLoading && (
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-4 pr-4">
              {/* AI Summary */}
              {(summaryLoading || summary) && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-sm font-medium mb-1">Summary</p>
                  {summaryLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      Generating summary...
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{summary}</p>
                  )}
                </div>
              )}

              {/* Stats bar */}
              {hasDiff && files.length > 0 && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
                  <span className="text-green-600">+{totalAdditions}</span>
                  <span className="text-destructive">-{totalDeletions}</span>
                </div>
              )}

              {/* File contents or diffs */}
              {hasDiff && files.length > 0 && (
                <div className="flex flex-col gap-1">
                  {files.map((file) => {
                    const isExpanded = expandedFiles.has(file.filename);
                    const content = fileContents[file.filename];
                    return (
                      <div key={file.filename} className="rounded-md border">
                        <button
                          type="button"
                          onClick={() => toggleFile(file.filename)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/30 rounded-t-md"
                        >
                          <ChevronDownIcon
                            className={`size-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                          />
                          <FileIcon className="size-4 text-muted-foreground" />
                          <span className="font-mono text-xs flex-1 truncate">{file.filename}</span>
                          <span className="text-xs text-green-600">+{file.additions}</span>
                          <span className="text-xs text-destructive">-{file.deletions}</span>
                        </button>
                        <Collapsible.Root open={isExpanded}>
                          <Collapsible.Content>
                            <Separator />
                            {content !== undefined ? (
                              content === '(file not accessible)' ? (
                                <p className="px-3 py-2 text-xs text-muted-foreground italic">File not accessible</p>
                              ) : (
                                <pre className="max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed">
                                  {content.split('\n').map((line, i) => (
                                    <span key={i} className="block">
                                      {line || ' '}
                                    </span>
                                  ))}
                                </pre>
                              )
                            ) : (
                              <pre className="max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed">
                                {file.header && (
                                  <span className="text-muted-foreground">{file.header}{'\n'}</span>
                                )}
                                {file.hunks.split('\n').map((line, i) => {
                                  let cls = '';
                                  if (line.startsWith('@@')) cls = 'text-blue-500';
                                  else if (line.startsWith('+')) cls = 'text-green-600';
                                  else if (line.startsWith('-')) cls = 'text-destructive';
                                  return (
                                    <span key={i} className={cls}>
                                      {line}{'\n'}
                                    </span>
                                  );
                                })}
                              </pre>
                            )}
                          </Collapsible.Content>
                        </Collapsible.Root>
                      </div>
                    );
                  })}
                </div>
              )}

              {hasDiff && !files.length && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">Diff available but could not be parsed into individual files.</p>
                  <Collapsible.Root open={showFullDiff} onOpenChange={setShowFullDiff}>
                    <Collapsible.Trigger asChild>
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                        <ChevronDownIcon className={`size-3 mr-1 transition-transform ${showFullDiff ? 'rotate-0' : '-rotate-90'}`} />
                        {showFullDiff ? 'Hide raw diff' : 'Show raw diff'}
                      </Button>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <pre className="mt-2 max-h-64 overflow-auto rounded border bg-muted/30 p-2 font-mono text-xs">
                        {run!.diff}
                      </pre>
                    </Collapsible.Content>
                  </Collapsible.Root>
                </div>
              )}

              {!hasDiff && !isLoading && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-sm text-muted-foreground">No file changes detected for this run.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <Separator />

        {showRejectReason ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Why are you rejecting these changes?</p>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Describe what needs to be improved or changed..."
              className="min-h-20 text-sm"
              autoFocus
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowRejectReason(false)}
                disabled={isRejecting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={isRejecting}
              >
                {isRejecting ? (
                  <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
                ) : (
                  <XCircleIcon data-icon="inline-start" />
                )}
                Reject
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRejectReason(true)}
              disabled={isPending}
              className="text-destructive border-destructive hover:bg-destructive/10"
            >
              <XCircleIcon data-icon="inline-start" />
              Reject
            </Button>
            <Button onClick={handleApprove} disabled={isPending}>
              {isApproving ? (
                <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
              ) : (
                <CheckCircle2Icon data-icon="inline-start" />
              )}
              Approve
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
