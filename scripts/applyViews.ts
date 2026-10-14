import 'dotenv/config';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const sql = postgres(url, { max: 1 });

await sql.unsafe(`
CREATE OR REPLACE VIEW manifest_summary AS
SELECT
  manifest_id,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE status = 'skipped') AS skipped,
  COUNT(*) FILTER (WHERE status = 'pending') AS pending
FROM manifest_entries
GROUP BY manifest_id;
`);

await sql.end();
console.log('manifest_summary view applied.');
