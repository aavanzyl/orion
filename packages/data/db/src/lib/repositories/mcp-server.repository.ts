import { eq } from 'drizzle-orm';
import type { CreateMcpServerInput, McpOAuthStored, McpServer, UpdateMcpServerInput } from '@orion/models';
import type { Database } from '../client.js';
import { mcpServers } from '../schema.js';
import { toMcpServer } from '../mappers.js';

export class McpServerRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<McpServer[]> {
    const rows = await this.db.select().from(mcpServers);
    return rows.map(toMcpServer);
  }

  async get(id: string): Promise<McpServer | null> {
    const [row] = await this.db.select().from(mcpServers).where(eq(mcpServers.id, id));
    return row ? toMcpServer(row) : null;
  }

  async getByName(name: string): Promise<McpServer | null> {
    const [row] = await this.db.select().from(mcpServers).where(eq(mcpServers.name, name));
    return row ? toMcpServer(row) : null;
  }

  async create(input: CreateMcpServerInput): Promise<McpServer> {
    const [row] = await this.db
      .insert(mcpServers)
      .values({
        name: input.name,
        config: input.config,
        authType: input.authType ?? 'none',
        oauth: (input.oauth ?? {}) as Record<string, unknown>,
      })
      .returning();
    return toMcpServer(row);
  }

  async update(id: string, patch: UpdateMcpServerInput): Promise<McpServer | null> {
    const values: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.config !== undefined) values.config = patch.config;
    if (patch.authType !== undefined) values.authType = patch.authType;
    if (patch.oauth !== undefined) values.oauth = (patch.oauth ?? {}) as Record<string, unknown>;

    const [row] = await this.db
      .update(mcpServers)
      .set(values)
      .where(eq(mcpServers.id, id))
      .returning();
    return row ? toMcpServer(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(mcpServers).where(eq(mcpServers.id, id));
  }

  /** Returns the raw oauth jsonb for a server (may contain encrypted secrets). */
  async getRawOauth(name: string): Promise<McpOAuthStored | null> {
    const [row] = await this.db
      .select({ oauth: mcpServers.oauth })
      .from(mcpServers)
      .where(eq(mcpServers.name, name));
    if (!row?.oauth) return null;
    return (row.oauth as Record<string, unknown>) as McpOAuthStored;
  }
}
