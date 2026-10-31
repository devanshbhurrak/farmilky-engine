import { sql } from 'drizzle-orm';
import { db } from '../../shared/db/client.js';
import { istToday, toDateOnlyString } from '../../shared/utils/dateUtils.js';

function monthStartStr(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-01`;
}

interface StatsRow {
  total_customers: number;
  total_orders: number;
  total_revenue: number;
  active_subscriptions: number;
  today_deliveries: number;
  today_delivered: number;
  monthly_revenue: number;
  pending_payments: number;
  pending_amount: number;
}

/** GET /stats — single SQL with subselects. */
export async function getAdminStats(tenantId: string): Promise<StatsRow> {
  const today = toDateOnlyString(istToday());
  const monthStart = monthStartStr(new Date());
  const rows = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM users
        WHERE tenant_id = ${tenantId} AND role = 'customer' AND deleted_at IS NULL) AS total_customers,
      (SELECT count(*)::int FROM orders
        WHERE tenant_id = ${tenantId} AND order_status <> 'cancelled') AS total_orders,
      (SELECT COALESCE(SUM(amount), 0)::float8 FROM transactions
        WHERE tenant_id = ${tenantId} AND txn_type IN ('delivery', 'order')
          AND entry_type = 'debit' AND status = 'active') AS total_revenue,
      (SELECT count(*)::int FROM subscriptions
        WHERE tenant_id = ${tenantId} AND status = 'active') AS active_subscriptions,
      (SELECT count(*)::int FROM subscription_deliveries
        WHERE tenant_id = ${tenantId} AND delivery_date = ${today}) AS today_deliveries,
      (SELECT count(*)::int FROM subscription_deliveries
        WHERE tenant_id = ${tenantId} AND delivery_date = ${today} AND status = 'delivered') AS today_delivered,
      (SELECT COALESCE(SUM(amount), 0)::float8 FROM transactions
        WHERE tenant_id = ${tenantId} AND txn_type IN ('delivery', 'order')
          AND entry_type = 'debit' AND status = 'active'
          AND effective_date >= ${monthStart}) AS monthly_revenue,
      (SELECT count(*)::int FROM users
        WHERE tenant_id = ${tenantId} AND role = 'customer' AND deleted_at IS NULL
          AND account_balance > 0) AS pending_payments,
      (SELECT COALESCE(SUM(account_balance), 0)::float8 FROM users
        WHERE tenant_id = ${tenantId} AND role = 'customer' AND deleted_at IS NULL
          AND account_balance > 0) AS pending_amount
  `)) as unknown as StatsRow[];
  const r = rows[0];
  if (!r) {
    return {
      total_customers: 0,
      total_orders: 0,
      total_revenue: 0,
      active_subscriptions: 0,
      today_deliveries: 0,
      today_delivered: 0,
      monthly_revenue: 0,
      pending_payments: 0,
      pending_amount: 0,
    };
  }
  return {
    total_customers: Number(r.total_customers ?? 0),
    total_orders: Number(r.total_orders ?? 0),
    total_revenue: Number(r.total_revenue ?? 0),
    active_subscriptions: Number(r.active_subscriptions ?? 0),
    today_deliveries: Number(r.today_deliveries ?? 0),
    today_delivered: Number(r.today_delivered ?? 0),
    monthly_revenue: Number(r.monthly_revenue ?? 0),
    pending_payments: Number(r.pending_payments ?? 0),
    pending_amount: Number(r.pending_amount ?? 0),
  };
}

/** GET /delivery-stats — monthly delivered qty + monthly milk collected. */
export async function getDeliveryStats(tenantId: string) {
  const monthStart = monthStartStr(new Date());
  const rows = (await db.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(actual_quantity), 0)::float8 FROM subscription_deliveries
        WHERE tenant_id = ${tenantId} AND delivery_date >= ${monthStart}
          AND status = 'delivered') AS delivered_qty,
      (SELECT COALESCE(SUM(actual_qty), 0)::float8 FROM milk_collections
        WHERE tenant_id = ${tenantId} AND collection_date >= ${monthStart}
          AND status = 'confirmed') AS milk_qty
  `)) as unknown as Array<{ delivered_qty: number; milk_qty: number }>;
  const r = rows[0] ?? { delivered_qty: 0, milk_qty: 0 };
  return {
    monthly: {
      deliveredQty: Number(r.delivered_qty ?? 0),
      milkQty: Number(r.milk_qty ?? 0),
    },
  };
}

export interface AgentStat {
  agent_id: string | null;
  agent_name: string | null;
  agent_phone: string | null;
  total_entries: number;
  delivered: number;
  failed: number;
  manifest_count: number;
  success_rate: number;
}

export interface AreaStat {
  area_id: string | null;
  area_name: string | null;
  total_entries: number;
  delivered: number;
  failed: number;
  manifest_count: number;
  success_rate: number;
}

/** GET /delivery-performance — agent/area success + open complaints + pending returns. */
export async function getDeliveryPerformance(tenantId: string, days = 7) {
  const clamped = Math.max(1, Math.min(90, Math.floor(days) || 7));
  const since = new Date();
  since.setDate(since.getDate() - clamped);
  since.setHours(0, 0, 0, 0);
  const sinceStr = toDateOnlyString(since);

  const [agentRows, areaRows, complaintRows, returnRows] = await Promise.all([
    db.execute(sql`
      SELECT u.id AS agent_id, u.name AS agent_name, u.phone AS agent_phone,
        COUNT(me.id)::int AS total_entries,
        SUM(CASE WHEN me.status = 'delivered' THEN 1 ELSE 0 END)::int AS delivered,
        SUM(CASE WHEN me.status = 'failed' THEN 1 ELSE 0 END)::int AS failed,
        COUNT(DISTINCT m.id)::int AS manifest_count,
        CASE WHEN COUNT(me.id) > 0
          THEN ROUND(SUM(CASE WHEN me.status = 'delivered' THEN 1 ELSE 0 END)::numeric / COUNT(me.id) * 100, 2)::float8
          ELSE 0 END AS success_rate
      FROM manifest_entries me
      JOIN delivery_manifests m ON m.id = me.manifest_id
      LEFT JOIN users u ON u.id = m.agent_id
      WHERE me.tenant_id = ${tenantId} AND m.manifest_date >= ${sinceStr}
      GROUP BY u.id, u.name, u.phone
      ORDER BY success_rate DESC
      LIMIT 20
    `) as unknown as AgentStat[],
    db.execute(sql`
      SELECT a.id AS area_id, a.name AS area_name,
        COUNT(me.id)::int AS total_entries,
        SUM(CASE WHEN me.status = 'delivered' THEN 1 ELSE 0 END)::int AS delivered,
        SUM(CASE WHEN me.status = 'failed' THEN 1 ELSE 0 END)::int AS failed,
        COUNT(DISTINCT m.id)::int AS manifest_count,
        CASE WHEN COUNT(me.id) > 0
          THEN ROUND(SUM(CASE WHEN me.status = 'delivered' THEN 1 ELSE 0 END)::numeric / COUNT(me.id) * 100, 2)::float8
          ELSE 0 END AS success_rate
      FROM manifest_entries me
      JOIN delivery_manifests m ON m.id = me.manifest_id
      LEFT JOIN areas a ON a.id = m.area_id
      WHERE me.tenant_id = ${tenantId} AND m.manifest_date >= ${sinceStr}
      GROUP BY a.id, a.name
      ORDER BY success_rate DESC
    `) as unknown as AreaStat[],
    db.execute(sql`
      SELECT count(*)::int AS total FROM complaints
      WHERE tenant_id = ${tenantId} AND status = 'open'
    `) as unknown as Array<{ total: number }>,
    db.execute(sql`
      SELECT count(*)::int AS total FROM returns
      WHERE tenant_id = ${tenantId} AND status = 'requested'
    `) as unknown as Array<{ total: number }>,
  ]);

  return {
    days: clamped,
    agentStats: agentRows,
    areaStats: areaRows,
    openComplaints: Number(complaintRows[0]?.total ?? 0),
    pendingReturns: Number(returnRows[0]?.total ?? 0),
  };
}

/** GET /profit-stats — today + month revenue/expenses/profit from the ledger. */
export async function getProfitStats(tenantId: string) {
  const today = toDateOnlyString(istToday());
  const monthStart = monthStartStr(new Date());
  const rows = (await db.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(amount), 0)::float8 FROM transactions
        WHERE tenant_id = ${tenantId} AND party_type = 'customer'
          AND txn_type IN ('delivery', 'order') AND entry_type = 'debit'
          AND status = 'active' AND effective_date = ${today}) AS today_revenue,
      (SELECT COALESCE(SUM(amount), 0)::float8 FROM transactions
        WHERE tenant_id = ${tenantId} AND party_type = 'customer'
          AND txn_type IN ('delivery', 'order') AND entry_type = 'debit'
          AND status = 'active' AND effective_date >= ${monthStart}) AS month_revenue,
      (SELECT COALESCE(SUM(amount), 0)::float8 FROM transactions
        WHERE tenant_id = ${tenantId} AND party_type = 'business'
          AND txn_type = 'expense' AND status = 'active'
          AND effective_date = ${today}) AS today_expenses,
      (SELECT COALESCE(SUM(amount), 0)::float8 FROM transactions
        WHERE tenant_id = ${tenantId} AND party_type = 'business'
          AND txn_type = 'expense' AND status = 'active'
          AND effective_date >= ${monthStart}) AS month_expenses
  `)) as unknown as Array<{
    today_revenue: number;
    month_revenue: number;
    today_expenses: number;
    month_expenses: number;
  }>;
  const r = rows[0] ?? { today_revenue: 0, month_revenue: 0, today_expenses: 0, month_expenses: 0 };
  const todayRevenue = Number(r.today_revenue ?? 0);
  const monthRevenue = Number(r.month_revenue ?? 0);
  const todayExpenses = Number(r.today_expenses ?? 0);
  const monthExpenses = Number(r.month_expenses ?? 0);
  return {
    today: { revenue: todayRevenue, expenses: todayExpenses, profit: todayRevenue - todayExpenses },
    month: { revenue: monthRevenue, expenses: monthExpenses, profit: monthRevenue - monthExpenses },
  };
}
