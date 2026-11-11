-- Change product_variants.stock from integer to numeric to support fractional quantities (e.g., 1.5L)
ALTER TABLE product_variants
  ALTER COLUMN stock TYPE numeric(10, 3) USING stock::numeric(10, 3),
  ALTER COLUMN stock SET DEFAULT 0;

-- Also update products.stock for consistency (if it exists as integer)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'stock' AND data_type = 'integer'
  ) THEN
    ALTER TABLE products
      ALTER COLUMN stock TYPE numeric(10, 3) USING stock::numeric(10, 3),
      ALTER COLUMN stock SET DEFAULT 0;
  END IF;
END $$;