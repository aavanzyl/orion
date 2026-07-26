import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Ticket } from '@orion/models';
import { api } from '@/lib/api';
import { TicketDetailSheet } from './ticket-detail-sheet';

export function TicketViewPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ticketId) {
      setLoading(false);
      return;
    }
    api.listAllTickets()
      .then((tickets) => {
        setTicket(tickets.find((t) => t.id === ticketId) ?? null);
      })
      .catch(() => setTicket(null))
      .finally(() => setLoading(false));
  }, [ticketId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-muted-foreground">Ticket not found.</p>
        <button
          type="button"
          onClick={() => navigate('/tickets')}
          className="text-sm text-primary hover:underline"
        >
          Back to tickets
        </button>
      </div>
    );
  }

  const handleChanged = () => {
    // Re-fetch not needed for standalone view
  };

  return (
    <TicketDetailSheet
      ticket={ticket}
      onClose={() => navigate('/tickets')}
      onChanged={handleChanged}
    />
  );
}
