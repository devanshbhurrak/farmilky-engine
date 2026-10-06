-- Farmilky RLS policies. Applied once via `npm run db:setup-rls` (scripts/applyRLS.ts).
-- Every tenant-scoped table enforces: tenant_id = current_setting('app.tenant_id', true)::uuid
-- The `true` arg returns NULL (no rows) instead of erroring when the setting is absent,
-- which keeps background jobs safe if they forget to set the variable.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'users','agent_profiles','user_addresses','refresh_tokens',
    'products','product_variants','customer_prices',
    'areas','carts',
    'orders','subscriptions','subscription_deliveries','subscription_changes',
    'transactions','invoice_allocations','transaction_settlements',
    'invoices','delivery_manifests','manifest_entries',
    'holidays','complaints','returns',
    'suppliers','milk_collections',
    'role_permissions','contact_messages'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(%L, true)::uuid)',
        t, 'app.tenant_id'
      );
    END IF;
  END LOOP;
END $$;
