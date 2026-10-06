import { db } from './client.js';

export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTransaction<T>(fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
