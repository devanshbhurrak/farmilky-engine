import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { Pool as NodePgPool } from 'pg';
import { Pool as NeonPool } from '@neondatabase/serverless';
import * as schema from './schema/index.js';
import { isWorkersRuntime } from '../config/env.js';
import dns from 'node:dns';

// If Node's default OS DNS resolver fails or returns intermittent ENOTFOUND for Neon endpoints,
// install a resilient fallback using resolve4 with public DNS resolvers in non-Workers environments.
if (!isWorkersRuntime() && typeof process !== 'undefined') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    const origLookup = dns.lookup;
    (dns as any).lookup = (hostname: string, options: any, callback: any) => {
      let cb = callback;
      let opt = options;
      if (typeof options === 'function') {
        cb = options;
        opt = {};
      }
      if (hostname && (hostname.includes('neon.tech') || hostname.includes('neon.build'))) {
        dns.resolve4(hostname, (err, addrs) => {
          if (!err && addrs && addrs.length > 0) {
            if (opt && opt.all) {
              return cb(null, addrs.map((a) => ({ address: a, family: 4 })));
            }
            return cb(null, addrs[0], 4);
          }
          return origLookup(hostname, opt, cb);
        });
        return;
      }
      return origLookup(hostname, opt, cb);
    };
  } catch {
    // Ignore if environment forbids mutating dns
  }
}

let databaseUrlOverride: string | undefined;
let queryClient: NodePgPool | NeonPool | undefined;
let dbInstance: any | undefined;

/**
 * Workers cannot read a local .env or rely on process.env, so the Worker entry
 * injects the Hyperdrive connection string here before the app handles traffic.
 */
export function configureDb(connectionString?: string): void {
  if (!connectionString) return;
  if (databaseUrlOverride && databaseUrlOverride !== connectionString && queryClient) {
    void (queryClient as any).end?.().catch(() => undefined);
    queryClient = undefined;
    dbInstance = undefined;
  }
  databaseUrlOverride = connectionString;
}

function getDatabaseUrl(): string {
  const rawUrl = databaseUrlOverride ?? (typeof process !== 'undefined' ? process.env.DATABASE_URL : undefined);
  if (!rawUrl) throw new Error('DATABASE_URL is not set');

  // Strip asyncpg and channel_binding if present to prevent driver hangs
  let url = rawUrl.replace(/^postgresql\+asyncpg:\/\//, 'postgresql://');
  url = url.replace(/([?&])channel_binding=[^&]*(&|$)/, '$1').replace(/[?&]$/, '');
  return url;
}

function getDb(): any {
  if (!dbInstance) {
    const connectionString = getDatabaseUrl();

    if (isWorkersRuntime()) {
      // Cloudflare Workers environment: use Neon serverless pool over WebSockets
      const pool = new NeonPool({ connectionString });
      queryClient = pool;
      dbInstance = drizzleNeon(pool, { schema });
    } else {
      // Node.js local environment: use standard pg Pool
      const pool = new NodePgPool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        allowExitOnIdle: true,
        application_name: 'farmilky-api',
      });
      pool.on('error', () => {
        // Pool-level errors
      });
      queryClient = pool;
      dbInstance = drizzleNodePg(pool, { schema });
    }
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

export type DB = NodePgDatabase<typeof schema>;

export async function connectDB(): Promise<void> {
  const { sql } = await import('drizzle-orm');
  await getDb().execute(sql`SELECT 1`);
}

export async function closeDB(): Promise<void> {
  if (queryClient && 'end' in queryClient) {
    await (queryClient as any).end();
  }
  queryClient = undefined;
  dbInstance = undefined;
}

