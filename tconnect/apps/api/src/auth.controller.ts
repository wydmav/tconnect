import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { pool, withTenant } from './lib/db';
import { pwdVerify, hmacSign, hmacVerify, enc, dec } from './lib/crypto';
import { issueSession } from './lib/session';
import { parse } from './lib/http';
import { ApiError } from './lib/errors';
import { Auth, Public, Actor } from './guards';
import { MFA_REQUIRED_ROLES } from '@tconnect/shared';

const Login = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });
const Totp = z.object({ tempToken: z.string(), code: z.string().regex(/^\d{6}$/) });

@Controller('api/auth') export class AuthController {
  @Public() @Get('status') async status() {
    const { rows } = await pool.query(`SELECT count(*)::int n FROM users`);
    return { setupNeeded: rows[0].n === 0 };
  }

  @Public() @Post('login') async login(@Body() body: unknown, @Res() res: Response, @Req() req: Request) {
    const d = parse(Login, body);
    const { rows } = await pool.query(`SELECT id, password_hash, totp_enabled, is_platform_owner FROM users WHERE email=$1`, [d.email]);
    const u = rows[0];
    if (!u || !(await pwdVerify(u.password_hash, d.password))) throw new ApiError(401, 'wrong email or password');
    if (u.totp_enabled) return res.json({ status: 'totp', tempToken: hmacSign('totp', u.id, 300) });
    const priv = await pool.query(
      `SELECT 1 FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.user_id=$1 AND r.key = ANY($2) LIMIT 1`,
      [u.id, MFA_REQUIRED_ROLES]);
    if (priv.rowCount || u.is_platform_owner) {   // privileged without MFA => force enrollment
      const secret = authenticator.generateSecret();
      await pool.query(`UPDATE users SET totp_secret_enc=$2 WHERE id=$1`, [u.id, enc(secret)]);
      const otpauth = authenticator.keyuri(d.email, 'T-Connect', secret);
      return res.json({ status: 'enroll', tempToken: hmacSign('enroll', u.id, 900), secret, otpauth, qr: await QRCode.toDataURL(otpauth) });
    }
    await pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [u.id]);
    await issueSession(res, u.id, req.ip);
    res.json({ status: 'ok' });
  }

  @Public() @Post('totp') async totp(@Body() body: unknown, @Res() res: Response, @Req() req: Request) {
    const d = parse(Totp, body);
    const t = hmacVerify(d.tempToken);
    if (!t || t.purpose !== 'totp') throw new ApiError(400, 'login attempt expired - start again');
    const { rows } = await pool.query(`SELECT totp_secret_enc FROM users WHERE id=$1`, [t.payload]);
    if (!rows[0] || !authenticator.verify({ token: d.code, secret: dec(rows[0].totp_secret_enc) }))
      throw new ApiError(401, 'invalid code');
    await pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [t.payload]);
    await issueSession(res, t.payload, req.ip);
    res.json({ status: 'ok' });
  }

  @Public() @Post('totp/enroll') async enroll(@Body() body: unknown, @Res() res: Response, @Req() req: Request) {
    const d = parse(Totp, body);
    const t = hmacVerify(d.tempToken);
    if (!t || t.purpose !== 'enroll') throw new ApiError(400, 'enrollment expired - log in again');
    const { rows } = await pool.query(`SELECT totp_secret_enc FROM users WHERE id=$1`, [t.payload]);
    if (!rows[0] || !authenticator.verify({ token: d.code, secret: dec(rows[0].totp_secret_enc) }))
      throw new ApiError(400, 'that code is not valid - scan the QR again');
    await pool.query(`UPDATE users SET totp_enabled=true, last_login_at=now() WHERE id=$1`, [t.payload]);
    await issueSession(res, t.payload, req.ip);
    res.json({ status: 'ok' });
  }

  @Auth() @Post('logout') async logout(@Res() res: Response, @Req() req: Request) {
    const sid = req.cookies?.tc_sid;
    if (sid) await pool.query(`DELETE FROM sessions WHERE id=$1`, [require('./lib/crypto').tokenHash(sid)]);
    res.clearCookie('tc_sid'); res.json({ ok: true });
  }

  @Auth() @Get('me') async me(@Actor() a: Actor) {
    const operators = await withTenant(a.operatorId, (c) => c.query(
      `SELECT o.id, o.name FROM member_roles mr JOIN operators o ON o.id=mr.operator_id WHERE mr.user_id=$1`, [a.userId]));
    return {
      user: { email: a.email, isPlatformOwner: a.isPlatformOwner },
      operatorId: a.operatorId, operators: operators.rows,
      permissions: { global: [...a.perms.global], sites: Object.fromEntries([...a.perms.sites].map(([k, v]) => [k, [...v]])) },
    };
  }

  @Auth() @Post('switch') async switch(@Actor() a: Actor, @Body() body: { operatorId: string }) {
    const m = await withTenant(body.operatorId, (c) => c.query(
      `SELECT 1 FROM member_roles WHERE user_id=$1 AND operator_id=$2`, [a.userId, body.operatorId]));
    if (!m.rowCount && !a.isPlatformOwner) throw new ApiError(403, 'not a member of that operator');
    await pool.query(`UPDATE sessions SET current_operator_id=$2 WHERE id=$1`, [a.sessionId, body.operatorId]);
    return { ok: true };
  }
}