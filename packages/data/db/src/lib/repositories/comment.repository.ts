import { asc, eq } from 'drizzle-orm';
import type { CommentAttachment, TicketComment } from '@orion/models';
import type { Database } from '../client.js';
import { ticketComments } from '../schema.js';
import { toTicketComment } from '../mappers.js';

export class CommentRepository {
  constructor(private readonly db: Database) {}

  async create(ticketId: string, body: string, attachments: CommentAttachment[] = []): Promise<TicketComment> {
    const [row] = await this.db
      .insert(ticketComments)
      .values({ ticketId, body, attachments })
      .returning();
    return toTicketComment(row);
  }

  async listByTicket(ticketId: string): Promise<TicketComment[]> {
    const rows = await this.db
      .select()
      .from(ticketComments)
      .where(eq(ticketComments.ticketId, ticketId))
      .orderBy(asc(ticketComments.createdAt));

    return rows.map(toTicketComment);
  }
}
