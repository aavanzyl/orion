import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { BoardSwimlane, Label as LabelModel, Ticket } from '@orion/models';
import { api } from '@/lib/api';
import { TicketSheet } from '@/features/board/ticket-sheet';

interface IssueDetailSheetProps {
  ticket: Ticket | null;
  onClose: () => void;
  onChanged: () => void;
}

export function IssueDetailSheet({ ticket, onClose, onChanged }: IssueDetailSheetProps) {
  const [labels, setLabels] = useState<LabelModel[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [swimlanes, setSwimlanes] = useState<BoardSwimlane[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadContext = useCallback(async () => {
    if (!ticket) {
      setLoaded(false);
      return;
    }
    try {
      const [labelsData, boardData] = await Promise.all([
        api.listLabels(ticket.projectId),
        api.getBoard(ticket.projectId),
      ]);
      setLabels(labelsData);
      setSwimlanes(boardData.swimlanes);
      setTickets(boardData.swimlanes.flatMap((c) => c.tickets));
      setLoaded(true);
    } catch {
      toast.error('Failed to load project context');
    }
  }, [ticket]);

  useEffect(() => {
    if (ticket) {
      void loadContext();
    } else {
      setLoaded(false);
    }
  }, [ticket, loadContext]);

  const createLabel = async (name: string, color: string) => {
    if (!ticket) return;
    await api.createLabel(ticket.projectId, { name, color });
    const updated = await api.listLabels(ticket.projectId);
    setLabels(updated);
  };

  return (
    <TicketSheet
      ticket={loaded ? ticket : null}
      projectId={ticket?.projectId ?? null}
      labels={labels}
      tickets={tickets}
      swimlanes={swimlanes}
      onCreateLabel={createLabel}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}
