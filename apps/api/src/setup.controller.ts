import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { pool, withTenant } from './lib/db';
import { pwdHash, hmacSign, hmacVerify, enc, dec } from './lib/crypto';
import { issueSession } from './lib/session';
import { parse } from './lib/http';
import { ApiError } from './lib/errors';
import { seedOperator } from './bootstrap';

const S1 = z.object({ operatorName: z.string().min(2), name: z.string().min(2), email: z.string().email().toLowerCase(), password: z.string().min(10) });
const S2 = z.object({ enrollToken: z.string(), code: z.string().regex(/^\d{6}$/) });

@Controller('api/setup') export class SetupController {
  @Get('status') async status() {
    const { rows } = await pool.query(`SELECT count(*)::int n FROM users`);
    return { needed: rows[0].n === 0 };
  }

  @Post() async create(@Body() body: unknown) {
    const d = parse(S1, body);
    const { rows } = await pool.query(`SELECT count(*)::int n FROM users`);
    if (rows[0].n !== 0) throw new ApiError(403, 'setup already completed');
    const secret = authenticator.generateSecret();
    const userId = await withTenant('*', async (c) => {
      const op = await c.query(
        `INSERT INTO operators (name, slug) VALUES ($1, $2) RETURNING id`,
        [d.operatorName, d.operatorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tconnect']);
      const operatorId: string = op.rows[0].id;
      await seedOperator(c, operatorId);
      const u = await c.query(
        `INSERT INTO users (email, name, password_hash, totp_secret_enc, is_platform_owner)
         VALUES ($1,$2,$3,$4,true) RETURNING id`, [d.email, d.name, await pwdHash(d.password), enc(secret)]);
      const ownerRole = await c.query(`SELECT id FROM roles WHERE operator_id=$1 AND key='owner'`, [operatorId]);
      await c.query(`INSERT INTO member_roles (user_id, operator_id, role_id, scope_type) VALUES ($1,$2,$3,'global')`,
        [u.rows[0].id, operatorId, ownerRole.rows[0].id]);
      return u.rows[0].id as string;
    });
    const otpauth = authenticator.keyuri(d.email, 'T-Connect', secret);
    return { enrollToken: hmacSign('enroll', userId, 900), secret, otpauth, qr: await QRCode.toDataURL(otpauth) };
  }

  @Post('verify') async verify(@Body() body: unknown, @Res() res: Response) {
    const d = parse(S2, body);
    const t = hmacVerify(d.enrollToken);
    if (!t || t.purpose !== 'enroll') throw new ApiError(400, 'setup link expired - start again');
    const { rows } = await pool.query(`SELECT totp_secret_enc FROM users WHERE id=$1`, [t.payload]);
    if (!rows[0] || !authenticator.verify({ token: d.code, secret: dec(rows[0].totp_secret_enc) }))
      throw new ApiError(400, 'that code is not valid - scan the QR again and enter the 6-digit code');
    await pool.query(`UPDATE users SET totp_enabled=true, last_login_at=now() WHERE id=$1`, [t.payload]);
    await issueSession(res, t.payload, res.req.ip);
    res.json({ ok: true });
  }
}