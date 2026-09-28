import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from 'argon2';
import { env } from '../env';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const tokenHash = (s: string) => sha256(s + env.TOKEN_PEPPER);
export const randomToken = (n = 32) => randomBytes(n).toString('base64url');
export const randomAlnum = (n: number, chars = 'abcdefghjkmnpqrstuvwxyz23456789') =>
  Array.from({ length: n }, () => chars[randomBytes(1)[0] % chars.length]).join('');
export const pwdHash = (p: string) => argonHash(p, { type: 2 });        // argon2id
export const pwdVerify = argonVerify;

export function hmacSign(purpose: string, payload: string, ttlSec: number): string {
  const exp = Date.now() + ttlSec * 1000;
  const body = `${purpose}|${payload}|${exp}`;
  return `${body}|${createHmac('sha256', env.SESSION_SECRET).update(body).digest('base64url')}`;
}
export function hmacVerify(token: string): { purpose: string; payload: string } | null {
  const parts = token.split('|'); if (parts.length !== 4) return null;
  const [purpose, payload, exp, sig] = parts;
  const expect = createHmac('sha256', env.SESSION_SECRET).update(`${purpose}|${payload}|${exp}`).digest('base64url');
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  if (Number(exp) < Date.now()) return null;
  return { purpose, payload };
}

export function enc(plain: string): string {  // AES-256-GCM envelope, "v1:iv:ct:tag"
  const key = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${ct.toString('base64')}:${c.getAuthTag().toString('base64')}`;
}
export function dec(envStr: string): string {
  const [v, iv, ct, tag] = envStr.split(':'); if (v !== 'v1') throw new Error('bad cipher version');
  const key = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}