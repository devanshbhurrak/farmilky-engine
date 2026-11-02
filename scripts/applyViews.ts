import 'dotenv/config';
import { Pool } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const pool = new Pool({ connectionString: url, max: 1 });

await pool.query(`
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

await pool.end();
console.log('manifest_summary view applied.');
