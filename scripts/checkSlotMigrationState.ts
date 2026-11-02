import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const pool = new Pool({ connectionString: url, max: 1 });

const tables = await pool.query(`
  SELECT tablename FROM pg_tables
  WHERE schemaname='public' AND tablename IN ('subscription_slots','subscriptions','drizzle_migrations','__drizzle_migrations')
`);
console.log('tables:', JSON.stringify(tables.rows));

const cols = await pool.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='subscriptions' AND column_name IN ('scheduled_slot','delivery_slot','tenant_settings')
`);
console.log('sub cols:', JSON.stringify(cols.rows));

await pool.end();
