import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { DbHandle } from './client.js';
import type * as schema from './schema.js';

/** Absolute path to the SQL migrations folder, resolved from this module. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/**
 * Apply pending SQL migrations. Postgres and PGlite reuse the SAME folder — the
 * migrations are authored as Postgres SQL and PGlite is Postgres in WASM.
 */
export async function runMigrations(
  handle: DbHandle,
  migrationsFolder = MIGRATIONS_DIR,
): Promise<void> {
  if (handle.dialect === 'pglite') {
    await migratePglite(handle.db as PgliteDatabase<typeof schema>, { migrationsFolder });
    return;
  }
  await migrate(handle.db as NodePgDatabase<typeof schema>, { migrationsFolder });
}

