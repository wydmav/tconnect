import { Response } from 'express';
import { pool, withTenant } from './db';
import { tokenHash, randomToken } from './crypto';
import { COOKIE_SECURE } from '../env';

export async function issueSession(res: Response, userId: string, ip?: string) {
  const operator = await pool.query(
    `SELECT operator_id FROM member_roles WHERE user_id=$1 ORDER BY created_at LIMIT 1`, [userId]);
  const token = randomToken();
  await withTenant(null, (c) => c.query(
    `INSERT INTO sessions (id, user_id, current_operator_id, csrf, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + interval '7 days')`,
    [tokenHash(token), userId, operator.rows[0]?.operator_id ?? null, randomToken(16), ip ?? null]));
  res.cookie('tc_sid', token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: 7 * 864e5 });
}