import { useEffect } from 'react';
import {
  LayoutDashboardIcon,
  MessagesSquareIcon,
  SettingsIcon,
  TicketIcon,
  WorkflowIcon,
  ActivityIcon,
  BarChart3Icon,
  ClipboardCheckIcon,
  DatabaseIcon,
  FolderKanbanIcon,
  ClockIcon,
  PlugIcon,
  WrenchIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ACCENT_PRESETS, useBranding } from '@/lib/use-branding';
import { useSidebar } from '@/lib/use-sidebar';

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

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Projects',
    items: [
      { to: '/projects', label: 'Projects', icon: FolderKanbanIcon, description: 'Manage projects and their config files' },
    ],
  },
  {
    title: 'Work',
    items: [
      { to: '/', label: 'Board', icon: LayoutDashboardIcon, end: true, description: 'Kanban board with drag-and-drop' },
      { to: '/issues', label: 'Issues', icon: TicketIcon, description: 'Search and filter all tickets' },
      { to: '/codebase', label: 'Codebase', icon: DatabaseIcon, description: 'Index and search project repositories' },
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
    title: 'Tools',
    items: [
      { to: '/workflows', label: 'Workflows', icon: WorkflowIcon, description: 'Browse and apply workflow templates' },
      { to: '/mcp', label: 'MCP', icon: PlugIcon, description: 'Model Context Protocol servers' },
      { to: '/skills', label: 'Skills', icon: WrenchIcon, description: 'Manage agent skills and tools' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { to: '/schedule', label: 'Schedule', icon: ClockIcon, description: 'Run agents on a cron schedule' },
    ],
  },
  {
    title: 'System',
    items: [
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

export function AppLayout() {
  const { branding } = useBranding();
  const { collapsed, toggle } = useSidebar();

  useEffect(() => {
    document.title = branding.title;
  }, [branding.title]);

  useEffect(() => {
    const { hue } = ACCENT_PRESETS[branding.accent] ?? ACCENT_PRESETS.blue;
    document.documentElement.style.setProperty('--primary-hue', String(hue));
  }, [branding.accent]);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen bg-background">
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200',
            collapsed ? 'w-16' : 'w-56',
          )}
        >
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
            {collapsed && (
              <img
                src={branding.logo || '/orion-mark.svg'}
                alt={branding.title}
                className="size-10 shrink-0 object-contain"
              />
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
            <nav className={cn('flex flex-col px-3 pb-4', collapsed ? 'gap-1.5' : 'gap-0.5')}>
              {NAV_SECTIONS.map((section) => (
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
              ))}
            </nav>
          </ScrollArea>
        </aside>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
}
