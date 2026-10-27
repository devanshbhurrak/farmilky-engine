-- Migration 0004: RLS for subscription_slots (per-slot config child of subscriptions).
-- Idempotent: safe to run multiple times. Applied via `npm run db:setup-rls`
-- (scripts/applyRLS.ts). The table carries its own tenant_id, so it uses the
-- direct tenant_isolation policy like its parent.
ALTER TABLE subscription_slots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscription_slots' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON subscription_slots
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
