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
    'orders','subscriptions','subscription_slots','subscription_deliveries','subscription_changes',
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

-- Child tables without their own tenant_id inherit isolation from the parent
-- row. Each policy checks the parent's tenant_id against the session variable
-- for both reads (USING) and writes (WITH CHECK).
DO $$ BEGIN
  ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cart_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON cart_items
      USING (cart_id IN (SELECT id FROM carts WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
      WITH CHECK (cart_id IN (SELECT id FROM carts WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
  END IF;

  ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON order_items
      USING (order_id IN (SELECT id FROM orders WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
      WITH CHECK (order_id IN (SELECT id FROM orders WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
  END IF;

  ALTER TABLE order_delivery_attempts ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_delivery_attempts' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON order_delivery_attempts
      USING (order_id IN (SELECT id FROM orders WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
      WITH CHECK (order_id IN (SELECT id FROM orders WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
  END IF;

  ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'invoice_line_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON invoice_line_items
      USING (invoice_id IN (SELECT id FROM invoices WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
      WITH CHECK (invoice_id IN (SELECT id FROM invoices WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
  END IF;

  ALTER TABLE invoice_product_summary ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'invoice_product_summary' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON invoice_product_summary
      USING (invoice_id IN (SELECT id FROM invoices WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
      WITH CHECK (invoice_id IN (SELECT id FROM invoices WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
  END IF;

  ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'return_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON return_items
      USING (return_id IN (SELECT id FROM returns WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
      WITH CHECK (return_id IN (SELECT id FROM returns WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
  END IF;

  ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_items' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON transaction_items
      USING (transaction_id IN (SELECT id FROM transactions WHERE tenant_id = current_setting('app.tenant_id', true)::uuid))
      WITH CHECK (transaction_id IN (SELECT id FROM transactions WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
  END IF;
END $$;

-- NOTE: subscription_changes carries its own tenant_id and is covered by the
-- direct tenant_isolation policy above.
