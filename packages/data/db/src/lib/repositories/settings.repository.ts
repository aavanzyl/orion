import { asc, eq } from 'drizzle-orm';
import type { AppSettings } from '@orion/models';
import type { Database } from '../client.js';
import { appSettings } from '../schema.js';
import { toAppSettings } from '../mappers.js';

const DEFAULT_BRANDING = { title: 'Orion', accent: '#6366f1' };
const DEFAULT_PREFERENCES = {
  agentDefaults: {},
  notifications: {
    toasts: true,
    desktop: false,
    runComplete: false,
    runFailed: true,
    syncComplete: false,
    approvalRequired: true,
    workflowTriggered: false,
    agentRunning: false,
    agentFailed: true,
  },
};

export interface UpdateAppSettingsInput {
  branding?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
}

export class SettingsRepository {
  constructor(private readonly db: Database) {}

  async get(): Promise<AppSettings> {
    const [row] = await this.db.select().from(appSettings).orderBy(asc(appSettings.createdAt));
    if (row) return toAppSettings(row);

    const [created] = await this.db
      .insert(appSettings)
      .values({ branding: DEFAULT_BRANDING as unknown as Record<string, unknown>, preferences: DEFAULT_PREFERENCES as unknown as Record<string, unknown> })
      .returning();
    return toAppSettings(created);
  }

  async update(patch: UpdateAppSettingsInput): Promise<AppSettings> {
    const current = await this.get();
    const [row] = await this.db.select().from(appSettings).orderBy(asc(appSettings.createdAt));
    if (!row) throw new Error('Settings row not found');

    const branding = patch.branding
      ? { ...(current.branding as unknown as Record<string, unknown>), ...patch.branding }
      : (row.branding as Record<string, unknown>);
    const preferences = patch.preferences
      ? { ...(current.preferences as unknown as Record<string, unknown>), ...patch.preferences }
      : (row.preferences as Record<string, unknown>);

    const [updated] = await this.db
      .update(appSettings)
      .set({ branding, preferences, updatedAt: new Date() })
      .where(eq(appSettings.id, row.id))
      .returning();
    return toAppSettings(updated);
  }
}
