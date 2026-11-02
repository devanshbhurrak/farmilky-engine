import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const dbDir = join(here, '..', 'src', 'shared', 'db');
const sqlFile = join(dbDir, 'rls.sql');
const migrationsDir = join(dbDir, 'migrations');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const pool = new Pool({ connectionString: url, max: 1 });
const contents = await readFile(sqlFile, 'utf8');
await pool.query(contents);

let migrations: string[] = [];
try {
  migrations = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
} catch {
  migrations = [];
}
for (const file of migrations) {
  const migration = await readFile(join(migrationsDir, file), 'utf8');
  await pool.query(migration);
  console.log(`Migration applied: ${file}`);
}

await pool.end();
console.log('RLS policies applied.');
