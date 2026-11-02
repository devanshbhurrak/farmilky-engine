// Applies the subscription_slots migration to a database that was set up
// manually (no drizzle bookkeeping table), so `drizzle-kit migrate` cannot be
// used. Idempotent: skips work that is already present.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const pool = new Pool({ connectionString: url, max: 1 });

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const tableExists = await pool.query(`
  SELECT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'subscription_slots'
  ) AS exists
`);
if (!tableExists.rows[0].exists) {
  const ddl = await readFile(join(root, 'drizzle', '0002_subscription_slots.sql'), 'utf8');
  const statements = ddl
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
  console.log(`Applied ${statements.length} DDL statements from 0002_subscription_slots.sql`);
} else {
  console.log('subscription_slots already exists — skipping DDL');
}

const colExists = await pool.query(`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'scheduled_slot'
  ) AS exists
`);
if (!colExists.rows[0].exists) {
  await pool.query('ALTER TABLE "subscriptions" ADD COLUMN "scheduled_slot" "delivery_slot"');
  console.log('Added subscriptions.scheduled_slot');
} else {
  console.log('subscriptions.scheduled_slot already exists — skipping');
}

const backfilled = await pool.query(`
  INSERT INTO "subscription_slots" ("tenant_id", "subscription_id", "delivery_slot", "quantity_per_delivery")
  SELECT "tenant_id", "id", "delivery_slot", "quantity_per_delivery"
  FROM "subscriptions"
  WHERE "quantity_per_delivery" > 0
  ON CONFLICT ("subscription_id", "delivery_slot") DO NOTHING
  RETURNING id
`);
console.log(`Backfilled ${backfilled.rowCount ?? 0} slot rows from existing subscriptions`);

const rls = await readFile(
  join(root, 'src', 'shared', 'db', 'migrations', '0004_subscription_slots_rls.sql'),
  'utf8',
);
await pool.query(rls);
console.log('Applied RLS policy for subscription_slots');

await pool.end();
