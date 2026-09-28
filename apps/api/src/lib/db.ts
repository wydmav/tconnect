import { Pool, PoolClient } from 'pg';
import { env } from '../env';

export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

/** Run fn inside a transaction scoped to one tenant (or '*' platform-wide). RLS fail-closed otherwise. */
export async function withTenant<T>(tenant: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (tenant) await c.query("SELECT set_config('app.tenant', $1, true)", [tenant]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}