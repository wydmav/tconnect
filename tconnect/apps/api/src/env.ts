import { z } from 'zod';
const E = z.object({
  DOMAIN: z.string().min(3), WG_HOST: z.string().min(3),
  WG_PORT: z.coerce.number().int().min(1).max(65535).default(51820),
  DATABASE_URL: z.string(), DATABASE_ADMIN_URL: z.string(), REDIS_URL: z.string(),
  APP_ENCRYPTION_KEY: z.string().min(40),
  TOKEN_PEPPER: z.string().min(16), SESSION_SECRET: z.string().min(16),
  WG_MANAGER_TOKEN: z.string().min(16),
  WG_MANAGER_URL: z.string().url().default('http://127.0.0.1:8080'),
  SMTP_URL: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
});
export const env = E.parse(process.env);
export const COOKIE_SECURE = env.COOKIE_SECURE !== 'false';