import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';
import { isWorkersRuntime } from '../config/env.js';

let databaseUrlOverride: string | undefined;
let queryClient: Pool | undefined;
let dbInstance: NodePgDatabase<typeof schema> | undefined;

/**
 * Workers cannot read a local .env or rely on process.env, so the Worker entry
 * injects the Hyperdrive connection string here before the app handles traffic.
 */
export function configureDb(connectionString?: string): void {
  if (!connectionString) return;
  if (databaseUrlOverride && databaseUrlOverride !== connectionString && queryClient) {
    void queryClient.end().catch(() => undefined);
    queryClient = undefined;
    dbInstance = undefined;
  }
  databaseUrlOverride = connectionString;
}

function getDatabaseUrl(): string {
  const url = databaseUrlOverride ?? (typeof process !== 'undefined' ? process.env.DATABASE_URL : undefined);
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    queryClient = new Pool({
      connectionString: getDatabaseUrl(),
      // Workers have a hard limit on concurrent external connections. Hyperdrive
      // pools the real database connections, so each isolate only needs a few.
      max: isWorkersRuntime() ? 5 : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: !isWorkersRuntime(),
      application_name: 'farmilky-api',
    });
    queryClient.on('error', () => {
      // Pool-level errors are expected when an idle connection is reset by the
      // database/proxy. Individual queries surface their own errors.
    });
    dbInstance = drizzle(queryClient, { schema });
  }
  return dbInstance;
}

// Lazy proxy so importing this module never requires DATABASE_URL at import time
// (important for unit tests that never touch the DB).
export const db: NodePgDatabase<typeof schema> = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<PropertyKey, unknown>)[prop];
  },
});

export type DB = typeof db;

export async function connectDB(): Promise<void> {
  const { sql } = await import('drizzle-orm');
  await getDb().execute(sql`SELECT 1`);
}

export async function closeDB(): Promise<void> {
  if (queryClient) await queryClient.end();
  queryClient = undefined;
  dbInstance = undefined;
}
