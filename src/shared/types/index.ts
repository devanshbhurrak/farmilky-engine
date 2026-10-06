export interface JwtPayload {
  userId: string;
  tenantId: string;
  role: string;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  role: string;
}

export type HonoEnv = {
  Variables: {
    user: AuthUser;
    body: unknown;
    query: unknown;
    params: unknown;
    requestId: string;
  };
};

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Drizzle transaction type — resolved lazily to avoid circular imports.
// Services accept `tx?: DrizzleTx`; repositories accept `dbOrTx: DB | DrizzleTx`.
import type { db } from '../db/client.js';
export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DBOrTx = typeof db | DrizzleTx;
