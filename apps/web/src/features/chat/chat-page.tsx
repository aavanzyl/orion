import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessagesSquareIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  PlayIcon,
  Trash2Icon,
  BrainIcon,
  WrenchIcon,
  TerminalIcon,
  ChevronRightIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { WorkflowRouteResult } from '@orion/models';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Markdown } from '@/components/markdown';
import { api } from '@/lib/api';
import { useProjects } from '@/features/projects/hooks';
import { useProjectConfig } from '@/features/board/hooks';
import { usePreferences } from '@/lib/use-preferences';
import { useProviders } from '@/features/settings/hooks';
import { useConversations } from './hooks';
import { useChatStream, type ChatStreamItem } from './use-chat-stream';

function itemIcon(type: string) {
  if (type === 'reasoning') return BrainIcon;
  if (type === 'command_execution') return TerminalIcon;
  return WrenchIcon;
}

function ActivityItem({ item }: { item: ChatStreamItem }) {
  const [open, setOpen] = useState(false);
  const Icon = itemIcon(item.type);
  const hasDetail = Boolean(item.detail);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-md px-1.5 py-1 text-left',
          hasDetail && 'hover:bg-muted',
        )}
      >
        {hasDetail ? (
          <ChevronRightIcon
            className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate font-medium">{item.title}</span>
        {item.status && item.status !== 'completed' && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-70">
            {item.status}
          </span>
        )}
      </button>
      {open && hasDetail && (
        <pre className="ml-6 mt-0.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-[11px] leading-snug">
          {item.detail}
        </pre>
      )}
    </div>
  );
}


export function ChatPage() {
  const { projects, loading: projectsLoading } = useProjects();
  const [projectId, setProjectId] = useState<string | null>(null);
  const { conversations, refetch, setConversations } = useConversations(projectId);
  const { config } = useProjectConfig(projectId);
  const { preferences } = usePreferences();
  const { providers } = useProviders();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const { messages, streamingText, items, streaming, error } = useChatStream(conversationId);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [route, setRoute] = useState<WorkflowRouteResult | null>(null);
  const [starting, setStarting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    setConversationId(null);
    setRoute(null);
  }, [projectId]);

  useEffect(() => {
    if (!conversationId && conversations.length > 0) setConversationId(conversations[0].id);
  }, [conversations, conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streamingText, items]);

  const activeAgent = useMemo(() => {
    const { harness, providerId } = preferences.agentDefaults;
    if (providerId) {
      const provider = providers.find((p) => p.id === providerId);
      if (provider) return provider.label || provider.key;
    }
    if (harness) return harness;
    const fromConfig = config?.workflow.nodes.find((n) => n.type === 'agent')?.provider;
    return fromConfig ?? undefined;
  }, [config, preferences.agentDefaults, providers]);

  const activeModel = useMemo(() => {
    const { providerId, model } = preferences.agentDefaults;
    if (providerId || model) return model || undefined;
    return config?.workflow.nodes.find((n) => n.type === 'agent')?.model || undefined;
  }, [config, preferences.agentDefaults]);

  const newConversation = async () => {
    if (!projectId) return;
    try {
      const conversation = await api.createConversation(projectId);
      setConversations((prev) => [conversation, ...prev]);
      setConversationId(conversation.id);
      setRoute(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((conversation) => conversation.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setRoute(null);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const send = async () => {
    const content = input.trim();
    if (!content || !projectId) return;
    let id = conversationId;
    setSending(true);
    try {
      if (!id) {
        const conversation = await api.createConversation(projectId);
        setConversations((prev) => [conversation, ...prev]);
        id = conversation.id;
        setConversationId(id);
      }
      await api.sendChatMessage(id, content);
      setInput('');
      refetch();
      void api
        .routeMessage(projectId, content)
        .then((result) => {
          if (result.intent === 'run' && result.workflowName) setRoute(result);
        })
        .catch(() => undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const suggest = async () => {
    const content = input.trim();
    if (!content || !projectId) return;
    try {
      setRoute(await api.routeMessage(projectId, content));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const startFromRoute = async () => {
    if (!projectId || !route || route.intent !== 'run') return;
    setStarting(true);
    try {
      const swimlane = config?.board.swimlanes[0];
      const ticket = await api.createTicket(projectId, {
        title: route.ticketTitle ?? 'New task',
        swimlane,
      });
      await api.startRun(ticket.id);
      toast.success(`Run started for "${ticket.title}"`);
      setRoute(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Chat</h1>
          <Select value={projectId ?? undefined} onValueChange={setProjectId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={projectsLoading ? 'Loading…' : 'Select a project'} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeAgent && (
            <Badge variant="secondary" className="font-mono">
              {activeAgent}
              {activeModel ? ` · ${activeModel}` : ''}
            </Badge>
          )}
        </div>
      </header>

      {!projectId ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          Select a project to start chatting.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r bg-muted/20">
            <div className="p-3">
              <Button size="sm" className="w-full shadow-sm" onClick={newConversation}>
                <PlusIcon data-icon="inline-start" />
                New conversation
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-0.5 px-3 pb-3">
                {conversations.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">No conversations yet.</p>
                ) : (
                  conversations.map((conversation) => (
                    <div key={conversation.id} className="group/conv relative">
                      <button
                        type="button"
                        onClick={() => {
                          setConversationId(conversation.id);
                          setRoute(null);
                        }}
                        className={cn(
                          'w-full truncate rounded-md py-2 pl-3 pr-9 text-left text-sm font-medium transition-all',
                          conversation.id === conversationId
                            ? 'bg-accent text-accent-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )}
                      >
                        {conversation.title}
                      </button>
                      <button
                        type="button"
                        aria-label="Delete conversation"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteConversation(conversation.id);
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-60 transition-opacity hover:bg-primary/10 hover:text-primary hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
                {messages.length === 0 && !streaming ? (
                  <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                    <MessagesSquareIcon className="size-8" />
                    <p className="text-sm">
                      Ask the agent anything, or describe a task to get a workflow recommendation.
                    </p>
                  </div>
                ) : (
                  messages.map((message) =>
                    message.role === 'user' ? (
                      <div key={message.id} className="flex justify-end">
                        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                          {message.content}
                        </div>
                      </div>
                    ) : (
                      <div key={message.id} className="flex flex-col gap-1.5">
                        <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 text-sm">
                          <Markdown content={message.content} />
                        </div>
                        {message.usage?.totalTokens ? (
                          <span className="px-1 text-xs text-muted-foreground">
                            {message.usage.totalTokens.toLocaleString()} tokens
                            {message.usage.costUsd ? ` · $${message.usage.costUsd.toFixed(2)}` : ''}
                          </span>
                        ) : null}
                      </div>
                    ),
                  )
                )}

                {streaming && (
                  <div className="flex flex-col gap-2">
                    {items.length > 0 && (
                      <div className="flex flex-col gap-0.5 rounded-xl border border-info/30 bg-info/5 p-2 text-xs text-muted-foreground">
                        {items.map((item) => (
                          <ActivityItem key={item.id} item={item} />
                        ))}
                      </div>
                    )}
                    <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-2.5 text-sm">
                      {streamingText ? (
                        <Markdown content={streamingText} />
                      ) : (
                        <span className="text-muted-foreground">Thinking...</span>
                      )}
                    </div>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                {route && (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <SparklesIcon className="size-4 text-primary" />
                        {route.intent === 'run' && route.workflowName
                          ? `Recommended: ${route.workflowTitle ?? route.workflowName}`
                          : 'Continue in chat'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <p className="text-sm text-muted-foreground">{route.reasoning}</p>
                      {route.intent === 'run' && route.workflowName && (
                        <Button
                          size="sm"
                          className="self-start"
                          onClick={startFromRoute}
                          disabled={starting}
                        >
                          <PlayIcon data-icon="inline-start" />
                          Create ticket &amp; start run
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <div className="border-t bg-muted/20 p-4">
              <div className="mx-auto flex max-w-3xl flex-col gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
                  className="min-h-[60px] resize-none border-border/50 bg-card"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={suggest} disabled={!input.trim()}>
                    <SparklesIcon data-icon="inline-start" />
                    Suggest workflow
                  </Button>
                  <Button size="sm" onClick={send} disabled={!input.trim() || sending}>
                    <SendIcon data-icon="inline-start" />
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
