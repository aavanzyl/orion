import { asc, desc, eq } from 'drizzle-orm';
import type {
  AddChatMessageInput,
  ChatMessage,
  Conversation,
  ConversationId,
  CreateConversationInput,
} from '@orion/models';
import type { Database } from '../client.js';
import { chatMessages, conversations } from '../schema.js';
import { toChatMessage, toConversation } from '../mappers.js';

export class ChatRepository {
  constructor(private readonly db: Database) {}

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const [row] = await this.db
      .insert(conversations)
      .values({
        projectId: input.projectId,
        title: input.title?.trim() || 'New conversation',
      })
      .returning();
    return toConversation(row);
  }

  async listConversations(projectId: string, limit = 20): Promise<Conversation[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, projectId))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows.map(toConversation);
  }

  /** Delete a conversation and (via cascade) its messages. */
  async deleteConversation(id: ConversationId): Promise<boolean> {
    const rows = await this.db
      .delete(conversations)
      .where(eq(conversations.id, id))
      .returning({ id: conversations.id });
    return rows.length > 0;
  }

  async getConversation(id: ConversationId): Promise<Conversation | null> {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, id));
    return row ? toConversation(row) : null;
  }

  async listMessages(conversationId: ConversationId): Promise<ChatMessage[]> {
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(asc(chatMessages.createdAt));
    return rows.map(toChatMessage);
  }

  async addMessage(input: AddChatMessageInput): Promise<ChatMessage> {
    const usage = input.usage;
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        costUsd: usage?.costUsd,
      })
      .returning();
    return toChatMessage(row);
  }

  async updateConversationTitle(id: ConversationId, title: string): Promise<Conversation | null> {
    const [row] = await this.db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return row ? toConversation(row) : null;
  }

  /** Bump a conversation's `updatedAt` (e.g. after new activity). */
  async touch(id: ConversationId): Promise<void> {
    await this.db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, id));
  }
}
