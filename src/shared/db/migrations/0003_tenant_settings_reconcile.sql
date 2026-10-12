-- Migration 0003: tenant settings JSONB + transaction reconcile flag.
-- Idempotent: safe to run multiple times. Applied via `npm run db:setup-rls`
-- (scripts/applyRLS.ts).

-- ---------- 6.1 Per-tenant business-rule overrides ----------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tenant_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------- 6.3 Payment reconciliation flag ----------
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false;
