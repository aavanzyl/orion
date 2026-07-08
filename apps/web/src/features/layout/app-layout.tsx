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
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

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
      { to: '/schedule', label: 'Schedule', icon: ClockIcon, description: 'Cron and webhook triggers' },
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
  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
          <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <img src="/orion-mark.svg" alt="Orion" className="size-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">Orion</span>
        </div>
        <ScrollArea className="flex-1">
          <nav className="flex flex-col gap-0.5 px-3 pb-4">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <SectionLabel>{section.title}</SectionLabel>
                {section.items.map(({ to, label, icon: Icon, end, description }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    title={description}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </ScrollArea>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
