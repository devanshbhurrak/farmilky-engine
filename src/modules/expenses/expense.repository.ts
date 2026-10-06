import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import type { DBOrTx } from '../../shared/types/index.js';
import { transactions } from '../../shared/db/schema/index.js';

export interface ExpenseListOpts {
  limit: number;
  offset: number;
  category?: string;
  startDate?: string;
  endDate?: string;
}

function expenseConditions(tenantId: string, opts: { category?: string; startDate?: string; endDate?: string }) {
  const conds = [
    eq(transactions.tenantId, tenantId),
    eq(transactions.partyType, 'business'),
    eq(transactions.txnType, 'expense'),
    eq(transactions.status, 'active'),
  ];
  if (opts.category) conds.push(eq(transactions.txnCategory, opts.category));
  if (opts.startDate) conds.push(gte(transactions.effectiveDate, opts.startDate));
  if (opts.endDate) conds.push(lte(transactions.effectiveDate, opts.endDate));
  return conds;
}

export async function listExpenses(tenantId: string, opts: ExpenseListOpts, dbOrTx: DBOrTx = db) {
  const conds = expenseConditions(tenantId, opts);
  const rows = await (dbOrTx as typeof db)
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.effectiveDate), desc(transactions.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [{ total }] = await (dbOrTx as typeof db)
    .select({ total: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(...conds));
  return { rows, total };
}

export async function summarizeExpenses(
  tenantId: string,
  opts: { startDate?: string; endDate?: string },
  dbOrTx: DBOrTx = db,
) {
  const conds = expenseConditions(tenantId, opts);
  const rows = await (dbOrTx as typeof db)
    .select({
      category: transactions.txnCategory,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(and(...conds))
    .groupBy(transactions.txnCategory);
  return rows.map((r) => ({ category: r.category ?? 'miscellaneous', total: Number(r.total) }));
}
