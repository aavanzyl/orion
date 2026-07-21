import { useEffect } from 'react';
import {
  LayoutDashboardIcon,
  MessagesSquareIcon,
  SettingsIcon,
  TicketIcon,
  WorkflowIcon,
  ActivityIcon,
  BarChart3Icon,
  BugIcon,
  ClipboardCheckIcon,
  DatabaseIcon,
  FolderKanbanIcon,
  ClockIcon,
  PlugIcon,
  WrenchIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  GitBranchIcon,
  CalendarIcon,
  NetworkIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
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
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ACCENT_PRESETS, useBranding } from '@/lib/use-branding';
import { useSidebar } from '@/lib/use-sidebar';
import { useProjectContext } from '@/lib/use-project-context';
import { useProjects } from '@/features/projects/hooks';

type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
  description?: string;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const PROJECT_SECTIONS: NavSection[] = [
  {
    title: 'Work',
    items: [
      { to: '/', label: 'Board', icon: LayoutDashboardIcon, end: true, description: 'Kanban board with drag-and-drop' },
      { to: '/issues', label: 'Issues', icon: TicketIcon, description: 'Search and filter all tickets' },
      { to: '/timeline', label: 'Timeline', icon: CalendarIcon, description: 'Project timeline with due dates' },
      { to: '/chat', label: 'Chat', icon: MessagesSquareIcon, description: 'Chat with your AI agents' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: ActivityIcon, description: 'Monitor active workflow runs' },
      { to: '/analytics', label: 'Analytics', icon: BarChart3Icon, description: 'Success rates, costs, and trends' },
      { to: '/evaluations', label: 'Evaluations', icon: ClipboardCheckIcon, description: 'Rate agent performance' },
    ],
  },
  {
    title: 'Codebase',
    items: [
      { to: '/codebase', label: 'Codebase Search', icon: DatabaseIcon, description: 'Index and search project repositories' },
      { to: '/codebase-graph', label: 'Codebase Graph', icon: GitBranchIcon, description: 'File dependency graph visualization' },
      { to: '/knowledge-graph', label: 'Knowledge Graph', icon: NetworkIcon, description: 'Multi-layered code knowledge graph' },
    ],
  },
];

const GLOBAL_SECTIONS: NavSection[] = [
  {
    title: 'Tools',
    items: [
      { to: '/workflows', label: 'Workflows', icon: WorkflowIcon, description: 'Browse and apply workflow templates' },
      { to: '/mcp', label: 'MCP', icon: PlugIcon, description: 'Model Context Protocol servers' },
      { to: '/skills', label: 'Skills', icon: WrenchIcon, description: 'Manage agent skills and tools' },
      { to: '/schedule', label: 'Schedule', icon: ClockIcon, description: 'Run agents on a cron schedule' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/debug', label: 'Debug', icon: BugIcon, description: 'Inspect workflow logs and transitions' },
      { to: '/settings', label: 'Settings', icon: SettingsIcon, description: 'Theme, providers, and connections' },
    ],
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 pt-4 pb-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/50">
      {children}
    </span>
  );
}

function Divider() {
  return <div className="mx-3 my-2 border-t border-sidebar-border" />;
}

function renderNavSections(sections: NavSection[], collapsed: boolean) {
  return sections.map((section) => (
    <div key={section.title} className={cn(collapsed && 'flex flex-col gap-1.5')}>
      {collapsed ? (
        <div className="pt-4" aria-hidden />
      ) : (
        <SectionLabel>{section.title}</SectionLabel>
      )}
      {section.items.map(({ to, label, icon: Icon, end, description }) => {
        const link = (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? undefined : description}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'flex items-center rounded-md text-sm font-medium transition-all duration-150',
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-1.5',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {!collapsed && label}
          </NavLink>
        );

        if (!collapsed) {
          return link;
        }

        return (
          <Tooltip key={to}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  ));
}

export function AppLayout() {
  const { branding } = useBranding();
  const { collapsed, toggle } = useSidebar();
  const { projectId, setProjectId } = useProjectContext();
  const { projects } = useProjects();

  useEffect(() => {
    document.title = branding.title;
  }, [branding.title]);

  useEffect(() => {
    const { hue } = ACCENT_PRESETS[branding.accent] ?? ACCENT_PRESETS.blue;
    document.documentElement.style.setProperty('--primary-hue', String(hue));
  }, [branding.accent]);

  useEffect(() => {
    if (!projectId && projects.length > 0) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects, setProjectId]);

  const selectedProject = projects.find((p) => p.id === projectId) ?? null;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200',
            collapsed ? 'w-16' : 'w-56',
          )}
        >
          {/* Branding header */}
          <div
            className={cn(
              'flex h-14 items-center border-b border-sidebar-border',
              collapsed ? 'justify-center px-2' : 'gap-2.5 px-3',
            )}
          >
            {!collapsed && (
              <>
                <img
                  src={branding.logo || '/orion-mark.svg'}
                  alt={branding.title}
                  className="size-10 shrink-0 object-contain"
                />
                <span className="flex-1 truncate text-base font-semibold tracking-tight">
                  {branding.title}
                </span>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-all duration-150 hover:bg-sidebar-accent/50 hover:text-foreground"
                >
                  {collapsed ? (
                    <PanelLeftOpenIcon className="size-4" />
                  ) : (
                    <PanelLeftCloseIcon className="size-4" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              </TooltipContent>
            </Tooltip>
          </div>

          <ScrollArea className="flex-1">
            {/* Project selector */}
            {collapsed ? (
              <div className="flex justify-center pt-3 pb-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex size-9 items-center justify-center rounded-md bg-sidebar-accent/30 text-sm font-semibold text-sidebar-accent-foreground"
                      aria-label={selectedProject?.name ?? 'Select project'}
                    >
                      {(selectedProject?.name ?? '?')[0].toUpperCase()}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {selectedProject?.name ?? 'No project selected'}
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <div className="px-3 pt-3 pb-1">
                <Select
                  value={projectId ?? ''}
                  onValueChange={(value) => setProjectId(value || null)}
                >
                  <SelectTrigger className="h-9 w-full text-sm">
                    <FolderKanbanIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder="Select project..." />
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
            )}

            <nav className={cn('flex flex-col px-3 pb-4', collapsed ? 'gap-1.5' : 'gap-0.5')}>
              {renderNavSections(PROJECT_SECTIONS, collapsed)}
              {!collapsed ? <Divider /> : <div className="pt-2" aria-hidden />}
              {renderNavSections(GLOBAL_SECTIONS, collapsed)}
            </nav>
          </ScrollArea>
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
}
