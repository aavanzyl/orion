import type { ProjectId } from './project.model.js';
import type { Ticket } from './ticket.model.js';

export interface BoardSwimlane {
  key: string;
  title: string;
  tickets: Ticket[];
}

export interface Board {
  projectId: ProjectId;
  swimlanes: BoardSwimlane[];
  /** Configurable issue types available for new tickets in this project. */
  issueTypes?: { value: string; label: string }[];
}
