import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

let queryClient: ReturnType<typeof postgres> | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

function getDb() {
  if (!dbInstance) {
    queryClient = postgres(getDatabaseUrl(), { max: 10 });
    dbInstance = drizzle(queryClient, { schema });
  }
  return dbInstance;
}

// Lazy proxy so importing this module never requires DATABASE_URL at import time
// (important for unit tests that never touch the DB).
export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy({} as never, {
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
}
