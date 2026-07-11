import { desc, eq } from 'drizzle-orm';
import type {
  CreateProviderInput,
  Provider,
  ProviderId,
  UpdateProviderInput,
} from '@orion/models';
import { defaultHarnessForProvider } from '@orion/models';
import type { Database } from '../client.js';
import { providers } from '../schema.js';
import { toProvider } from '../mappers.js';

export class ProviderRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Provider[]> {
    const rows = await this.db.select().from(providers).orderBy(desc(providers.createdAt));
    return rows.map(toProvider);
  }

  async get(id: ProviderId): Promise<Provider | null> {
    const [row] = await this.db.select().from(providers).where(eq(providers.id, id));
    return row ? toProvider(row) : null;
  }

  async create(input: CreateProviderInput): Promise<Provider> {
    const [row] = await this.db
      .insert(providers)
      .values({
        key: input.key,
        label: input.label ?? '',
        harness: input.harness ?? defaultHarnessForProvider(input.key),
        baseUrl: input.baseUrl ?? null,
        apiKey: input.apiKey ?? null,
        models: input.models ?? [],
      })
      .returning();
    return toProvider(row);
  }

  async update(id: ProviderId, input: UpdateProviderInput): Promise<Provider | null> {
    const values: Partial<typeof providers.$inferInsert> = { updatedAt: new Date() };
    if (input.key !== undefined) values.key = input.key;
    if (input.harness !== undefined) values.harness = input.harness ?? null;
    if (input.label !== undefined) values.label = input.label;
    if (input.baseUrl !== undefined) values.baseUrl = input.baseUrl ?? null;
    if (input.models !== undefined) values.models = input.models;
    if (input.apiKey !== undefined) values.apiKey = input.apiKey || null;

    const [row] = await this.db
      .update(providers)
      .set(values)
      .where(eq(providers.id, id))
      .returning();
    return row ? toProvider(row) : null;
  }

  async delete(id: ProviderId): Promise<void> {
    await this.db.delete(providers).where(eq(providers.id, id));
  }

  /** Returns the raw stored API key (may be encrypted). Null when not set. */
  async getApiKey(id: ProviderId): Promise<string | null> {
    const [row] = await this.db
      .select({ apiKey: providers.apiKey })
      .from(providers)
      .where(eq(providers.id, id));
    return row?.apiKey ?? null;
  }
}
