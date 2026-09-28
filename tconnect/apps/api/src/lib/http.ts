import { z } from 'zod';
import Redis from 'ioredis';
import { pool } from './db';
import { ApiError } from './errors';
import { env } from '../env';

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new ApiError(400, r.error.issues[0]?.message ?? 'invalid input');
  return r.data;
}

const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
redis.connect().catch(() => console.warn('[api] redis down - rate limiting degraded'));

export async function limit(key: string, max: number, windowSec: number) {
  try {
    const k = `rl:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    if (n > max) throw new ApiError(429, 'too many requests - slow down');
  } catch (e) { if (e instanceof ApiError) throw e; }
}

export async function audit(o: { operatorId: string | null; userId?: string | null; action: string; entityType?: string; entityId?: string; data?: any; ip?: string }) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant', $1, true)", [o.operatorId ?? '*']);
    await c.query(
      `INSERT INTO audit_logs (operator_id, user_id, action, entity_type, entity_id, data, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [o.operatorId, o.userId ?? null, o.action, o.entityType ?? null, o.entityId ?? null, JSON.stringify(o.data ?? {}), o.ip ?? null]);
    await c.query('COMMIT');
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} console.error('[audit failed]', e); }
  finally { c.release(); }
}