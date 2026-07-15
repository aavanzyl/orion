import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import * as schema from './schema.js';

/**
 * Shared client type satisfied by both the node-postgres and PGlite drivers —
 * both extend `PgDatabase` from `drizzle-orm/pg-core`, so the repositories are
 * dialect-agnostic. `NodePgDatabase` and `PgliteDatabase` are assignable here.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbDialect = 'postgres' | 'pglite';

export interface DbHandle {
  db: Database;
  dialect: DbDialect;
  close(): Promise<void>;
}

/**
 * Infer the target dialect from a connection string. Postgres remains the
 * default: only explicit pglite/file/memory forms opt into the embedded engine.
 */
function detectDialect(connectionString: string): DbDialect {
  if (/^postgres(ql)?:\/\//i.test(connectionString)) return 'postgres';
  if (
    /^pglite:/i.test(connectionString) ||
    /^file:/i.test(connectionString) ||
    /^memory:\/\//i.test(connectionString) ||
    connectionString === 'memory'
  ) {
    return 'pglite';
  }
  return 'postgres';
}

/** Strip the pglite/file scheme; empty or `memory` means an in-memory database. */
function pgliteDataDir(connectionString: string): string | undefined {
  const dir = connectionString.replace(/^(pglite|file):(\/\/)?/i, '');
  if (dir === '' || dir === 'memory' || /^memory:\/\//i.test(connectionString)) {
    return undefined;
  }
  return dir;
}

/** Create a Drizzle client dispatched on the connection string's dialect. */
export function createDb(connectionString: string): DbHandle {
  const dialect = detectDialect(connectionString);

  if (dialect === 'pglite') {
    const dataDir = pgliteDataDir(connectionString);
    const client = dataDir ? new PGlite(dataDir) : new PGlite();
    const db = drizzlePglite(client, { schema });
    return { db, dialect, close: () => client.close() };
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, dialect, close: () => pool.end() };
}


