import type { ProjectId } from './project.model.js';
import type { Ticket } from './ticket.model.js';

export interface BoardSwimlane {
  key: string;
  title: string;
  tickets: Ticket[];
  /** Workflow names that have sub-swimlanes in this swimlane. Derived from board triggers. */
  workflows?: string[];
}

export interface Board {
  projectId: ProjectId;
  swimlanes: BoardSwimlane[];
}
