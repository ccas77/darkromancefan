import { env } from './env';
import schema from './schema.sql?raw';
import { seed } from './seed';
import { importRecs } from './recs-import';

type Row = Record<string, any>;
type Runner = (text: string, params?: any[]) => Promise<Row[]>;

let runner: Runner | null = null;
let ready: Promise<void> | null = null;

async function makeRunner(): Promise<Runner> {
  const url = env('DATABASE_URL');
  if (url) {
    const { Pool } = await import('@neondatabase/serverless');
    const pool = new Pool({ connectionString: url });
    return async (text, params = []) => (await pool.query(text, params)).rows;
  }
  // Local development database (embedded Postgres), stored in ./.data
  const { PGlite } = await import('@electric-sql/pglite');
  const g = globalThis as any;
  // Without DATABASE_URL: a local database. On Vercel this lives in /tmp and resets, so it's for previews only.
  const dir = process.env.VERCEL ? '/tmp/pglite' : './.data/pglite';
  (await import('node:fs')).mkdirSync(dir, { recursive: true });
  g.__pglite ??= new PGlite(dir);
  const db = g.__pglite;
  return async (text, params = []) => (await db.query(text, params)).rows as Row[];
}

async function init() {
  runner = await makeRunner();
  for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
    await runner(stmt);
  }
  const [{ n }] = await runner('SELECT count(*)::int AS n FROM books');
  if (n === 0) await seed(runner);
  await importRecs(runner);
}

export async function q<T = Row>(text: string, params: any[] = []): Promise<T[]> {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  await ready;
  return (await runner!(text, params)) as T[];
}

export async function one<T = Row>(text: string, params: any[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

export async function audit(actor: string, action: string, target = '', details: any = '') {
  await q('INSERT INTO audit_log (actor, action, target, details) VALUES ($1,$2,$3,$4)', [
    actor, action, target, typeof details === 'string' ? details : JSON.stringify(details),
  ]);
}
