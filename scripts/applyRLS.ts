import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const sqlFile = join(here, '..', 'src', 'shared', 'db', 'rls.sql');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const sql = postgres(url, { max: 1 });
const contents = await readFile(sqlFile, 'utf8');
await sql.unsafe(contents);
await sql.end();
console.log('RLS policies applied.');
