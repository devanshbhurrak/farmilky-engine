-- Migration 0002: RLS for child tables + missing indexes + balance/price CHECKs.
-- Idempotent: safe to run multiple times (IF NOT EXISTS / pg_policies /
-- pg_constraint guards). Applied via `npm run db:setup-rls` (scripts/applyRLS.ts).

-- ---------- 3.1 Child-table RLS (parent-join policies) ----------
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

-- ---------- 3.2 Missing indexes ----------
-- Cart duplicate detection (cart + product + variant, matching
-- findCartItemByProduct semantics).
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_product_unique
  ON cart_items (cart_id, product_id, variant_id);
-- NULL-variant lines (plain unique indexes treat NULLs as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_product_novariant_unique
  ON cart_items (cart_id, product_id) WHERE variant_id IS NULL;

-- Subscription product lookup.
CREATE INDEX IF NOT EXISTS subs_tenant_product_idx
  ON subscriptions (tenant_id, product_id);

-- ---------- 3.3 Balance & price CHECK constraints ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_balance_non_negative') THEN
    ALTER TABLE users ADD CONSTRAINT users_balance_non_negative
      CHECK (account_balance >= -99999.99);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subs_price_positive') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subs_price_positive
      CHECK (price_per_packet > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_balance_bounded') THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_balance_bounded
      CHECK (balance >= -999999.99 AND balance <= 9999999.99);
  END IF;
END $$;
