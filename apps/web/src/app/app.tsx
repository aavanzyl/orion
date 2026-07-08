import { Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from '@/features/layout/app-layout';
import { BoardPage } from '@/features/board/board-page';
import { ChatPage } from '@/features/chat/chat-page';
import { ProjectsPage } from '@/features/projects/projects-page';
import { ConfigEditorPage } from '@/features/projects/config-editor-page';
import { WorkflowsPage } from '@/features/workflows/workflows-page';
import { WorkflowBuilderPage } from '@/features/workflow-builder/workflow-builder-page';
import { WorkflowTemplateView } from '@/features/workflow-builder/workflow-template-view';
import { TriggersPage } from '@/features/triggers/triggers-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { AnalyticsPage } from '@/features/analytics/analytics-page';
import { EvaluationsPage } from '@/features/evaluations/evaluations-page';
import { CodebasePage } from '@/features/codebase/codebase-page';
import { IssuesPage } from '@/features/issues/issues-page';
import { McpPage } from '@/features/mcp/mcp-page';
import { SkillsPage } from '@/features/skills/skills-page';

export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<BoardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/evaluations" element={<EvaluationsPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId/builder" element={<WorkflowBuilderPage />} />
          <Route path="/projects/:projectId/config" element={<ConfigEditorPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/workflows/:name" element={<WorkflowTemplateView />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/schedule" element={<TriggersPage />} />
          <Route path="/codebase" element={<CodebasePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/mcp" element={<McpPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="*" element={<BoardPage />} />
        </Route>
      </Routes>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
