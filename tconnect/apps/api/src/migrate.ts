import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { env } from './env';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pw = (url: string) => decodeURIComponent(url.split('//')[1].split('@')[0].split(':')[1]);

export async function runMigrations() {
  const admin = new Pool({ connectionString: env.DATABASE_ADMIN_URL, max: 2 });
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_api') THEN CREATE ROLE app_api LOGIN; END IF; END $$;`);
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='app_radius') THEN CREATE ROLE app_radius LOGIN; END IF; END $$;`);
  await admin.query(`ALTER ROLE app_api WITH LOGIN PASSWORD ${q(pw(env.DATABASE_URL))};`);
  await admin.query(`ALTER ROLE app_radius WITH LOGIN PASSWORD ${q(pw(env.RADIUS_DATABASE_URL ?? env.DATABASE_URL))};`);
  await admin.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
  const dir = join(__dirname, '..', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const done = await admin.query(`SELECT 1 FROM schema_migrations WHERE name=$1`, [f]);
    if (done.rowCount) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query(sql); await c.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]); await c.query('COMMIT'); console.log('[migrate] applied', f); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  await admin.end();
}