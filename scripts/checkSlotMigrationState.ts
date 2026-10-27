import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 1 });

const tables = await sql`
  SELECT tablename FROM pg_tables
  WHERE schemaname='public' AND tablename IN ('subscription_slots','subscriptions','drizzle_migrations','__drizzle_migrations')
`;
console.log('tables:', JSON.stringify(tables));

const cols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='subscriptions' AND column_name IN ('scheduled_slot','delivery_slot','tenant_settings')
`;
console.log('sub cols:', JSON.stringify(cols));

await sql.end();
