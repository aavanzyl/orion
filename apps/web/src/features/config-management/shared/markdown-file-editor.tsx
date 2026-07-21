import { useEffect, useState } from 'react';
import { FileWarningIcon, SaveIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

const TEMPLATE = `# Instructions

Define the agent's role, scope, constraints, and expected output format.
Orion substitutes template variables at run time:

## Run variables

- \`$ARGUMENTS\` — ticket title followed by the full description
- \`$TICKET_TITLE\` — ticket title only
- \`$REPOSITORY\` — the project name
- \`$REPOSITORIES\` — all linked repositories (comma-separated)
- \`$BRANCH\` — the active run branch
- \`$BASE_BRANCH\` — the project's default branch (e.g. main)
- \`$WORKFLOW_ID\` — the unique run identifier

## Upstream node outputs

Reference another node's result with \`{{ nodes.<id> }} \` (serializes as JSON)
or drill into a field with \`{{ nodes.<id>.<field> }}\`:

\`\`\`
{{ nodes.plan }}
{{ nodes.plan.finalResponse }}
\`\`\`

---

## Guidance

Be specific about:

1. **Role** — who the agent is and what it should focus on.  Prefer concrete
   roles ("You are a TypeScript refactoring specialist reviewing…") over vague
   ones.
2. **Scope** — which files, subsystems, or concerns the agent should touch
   and, just as importantly, what it must NOT change.
3. **Output format** — how the agent should report back.  Structured output
   (lists, tables, severity levels) gets more consistent results than free-form
   prose.
4. **Constraints** — read-only vs. read-write, any hard limits (e.g. "do not
   modify test fixtures"), or domain rules to follow.
5. **On failure** — what to do when the agent cannot complete the task.  A
   clear "say exactly X and stop" keeps the workflow predictable.

### Example

\`\`\`md
You are a code reviewer focused on correctness.  Review ONLY the working
changes on branch $BRANCH (base $BASE_BRANCH) of $REPOSITORY for the ticket
"$TICKET_TITLE".  This is a READ-ONLY review — do NOT modify any code.

Return findings grouped by severity (BLOCKER, MAJOR, MINOR, NIT), each with
the file path and a suggested fix.  If no issues are found, say "No issues".

Ticket details:
$ARGUMENTS
\`\`\`
`;

export interface MarkdownFileEditorProps {
  projectId: string | null;
  /** Path of the command file relative to \`.orion/\`, e.g. \`commands/implement.md\`. */
  path: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (path: string) => void;
}

export function MarkdownFileEditor({
  projectId,
  path,
  onOpenChange,
  onSaved,
}: MarkdownFileEditorProps) {
  const [content, setContent] = useState('');
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = Boolean(projectId && path);

  useEffect(() => {
    if (!projectId || !path) return;
    setError(null);
    setContent('');
    setLoading(true);
    api
      .getCommandFile(projectId, path)
      .then((res) => {
        setExists(res.content !== null);
        setContent(res.content ?? TEMPLATE);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId, path]);

  const save = async () => {
    if (!projectId || !path) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveCommandFile(projectId, path, content);
      toast.success('File saved');
      setExists(true);
      onSaved?.(path);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
      toast.error('Could not save file');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit instructions</DialogTitle>
          <DialogDescription>
            <code>.orion/{path}</code>
            {!exists && ' — new file, starting from a template.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <FileWarningIcon className="mt-0.5 size-4 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={loading || saving}
            spellCheck={false}
            className="min-h-[50vh] flex-1 resize-none font-mono text-xs"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={loading || saving}>
            <SaveIcon data-icon="inline-start" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
