import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { pool, withTenant } from './lib/db';
import { parse, audit } from './lib/http';
import { ApiError } from './lib/errors';
import { tokenHash, randomToken, pwdHash, hmacSign, enc } from './lib/crypto';
import { Auth, Public, RequirePerm, Actor } from './guards';
import { env } from './env';

const InviteIn = z.object({ email: z.string().email().toLowerCase(), roleKey: z.string(), scopeType: z.enum(['global', 'site']).default('global'), siteId: z.number().int().optional() });
const AcceptIn = z.object({ token: z.string(), name: z.string().min(2), password: z.string().min(10) });
const APP_LINK = () => `https://${env.DOMAIN}`;

@Auth() @Controller('api/team') export class TeamController {
  @Get('members') @RequirePerm('team.read') async members(@Actor() a: Actor) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(
      `SELECT u.id, u.email, u.name, u.last_login_at,
        json_agg(json_build_object('role', r.key, 'roleName', r.name, 'scope', mr.scope_type, 'siteId', mr.site_id)) roles
       FROM member_roles mr JOIN users u ON u.id=mr.user_id JOIN roles r ON r.id=mr.role_id
       WHERE mr.operator_id=$1 GROUP BY u.id ORDER BY u.created_at`, [a.operatorId]));
    return { members: rows };
  }

  @Patch('members/:userId/roles') @RequirePerm('team.manage') async setRoles(@Actor() a: Actor, @Param('userId') userId: string,
      @Body() body: { roles: { roleKey: string; scopeType: 'global' | 'site'; siteId?: number }[] }) {
    const d = parse(z.object({ roles: z.array(z.object({ roleKey: z.string(), scopeType: z.enum(['global','site']), siteId: z.number().int().optional() })).min(1) }), body);
    await withTenant(a.operatorId, async (c) => {
      await c.query(`DELETE FROM member_roles WHERE user_id=$1 AND operator_id=$2`, [userId, a.operatorId]);
      for (const r of d.roles) {
        const role = await c.query(`SELECT id, key FROM roles WHERE operator_id=$1 AND key=$2`, [a.operatorId, r.roleKey]);
        if (!role.rows[0]) throw new ApiError(400, `unknown role ${r.roleKey}`);
        if (role.rows[0].key === 'owner') {   // never remove the last active owner
          const owners = await c.query(
            `SELECT count(DISTINCT mr.user_id)::int n FROM member_roles mr JOIN roles r2 ON r2.id=mr.role_id
             WHERE mr.operator_id=$1 AND r2.key='owner' AND mr.scope_type='global' AND mr.user_id <> $2`, [a.operatorId, userId]);
          if (owners.rows[0].n === 0 && !d.roles.some((x) => x.roleKey === 'owner'))
            throw new ApiError(400, 'cannot remove the last owner');
        }
        await c.query(`INSERT INTO member_roles (user_id, operator_id, role_id, scope_type, site_id) VALUES ($1,$2,$3,$4,$5)`,
          [userId, a.operatorId, role.rows[0].id, r.scopeType, r.scopeType === 'site' ? (r.siteId ?? null) : null]);
      }
    });
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'team.roles.set', entityType: 'user', entityId: userId, data: d });
    return { ok: true };   // effective on the member's next request — sessions are server-side
  }

  @Delete('members/:userId') @RequirePerm('team.manage') async remove(@Actor() a: Actor, @Param('userId') userId: string) {
    await withTenant(a.operatorId, (c) => c.query(`DELETE FROM member_roles WHERE user_id=$1 AND operator_id=$2`, [userId, a.operatorId]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'team.member.remove', entityType: 'user', entityId: userId });
    return { ok: true };
  }

  @Post('invites') @RequirePerm('invites.manage') async invite(@Actor() a: Actor, @Body() body: unknown, @Req() req: Request) {
    const d = parse(InviteIn, body);
    const token = randomToken(24);
    const r = await withTenant(a.operatorId, async (c) => {
      const role = await c.query(`SELECT id FROM roles WHERE operator_id=$1 AND key=$2`, [a.operatorId, d.roleKey]);
      if (!role.rows[0]) throw new ApiError(400, 'unknown role');
      const i = await c.query(
        `INSERT INTO invites (operator_id, email, role_id, scope_type, site_id, token_hash, invited_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '7 days') RETURNING id, expires_at`,
        [a.operatorId, d.email, role.rows[0].id, d.scopeType, d.scopeType === 'site' ? (d.siteId ?? null) : null, tokenHash(token), a.userId]);
      return i.rows[0];
    });
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'invite.create', entityType: 'invite', entityId: String(r.id), data: { email: d.email, role: d.roleKey }, ip: req.ip });
    return { id: r.id, expiresAt: r.expires_at, link: `${APP_LINK()}/invite/${token}` };
  }

  @Get('invites') @RequirePerm('invites.manage') async invites(@Actor() a: Actor) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(
      `SELECT i.id, i.email, i.status, i.created_at, i.expires_at, i.accepted_at, r.key role_key, r.name role_name, i.scope_type, i.site_id
       FROM invites i JOIN roles r ON r.id=i.role_id
       WHERE i.status='pending' OR i.accepted_at > now() - interval '30 days' ORDER BY i.created_at DESC`));
    return { invites: rows.map((x: any) => ({ ...x, status: x.status === 'pending' && new Date(x.expires_at) < new Date() ? 'expired' : x.status })) };
  }

  @Post('invites/:id/resend') @RequirePerm('invites.manage') async resend(@Actor() a: Actor, @Param('id') id: string) {
    const token = randomToken(24);
    const r = await withTenant(a.operatorId, (c) => c.query(
      `UPDATE invites SET token_hash=$2, status='pending', expires_at=now()+interval '7 days' WHERE id=$1 AND status IN ('pending','expired') RETURNING id`,
      [Number(id), tokenHash(token)]));
    if (!r.rows[0]) throw new ApiError(404, 'invite not found or already used');
    return { link: `${APP_LINK()}/invite/${token}` };
  }

  @Post('invites/:id/revoke') @RequirePerm('invites.manage') async revoke(@Actor() a: Actor, @Param('id') id: string) {
    await withTenant(a.operatorId, (c) => c.query(`UPDATE invites SET status='revoked' WHERE id=$1 AND status='pending'`, [Number(id)]));
    return { ok: true };
  }
}

/** Public: preview + accept an invite. The person exists only after accepting. */
@Public() @Controller('api/invites') export class InvitesPublicController {
  @Get('preview') async preview(@Req() req: Request) {
    const token = String((req as any).query.token ?? '');
    const { rows } = await withTenant('*', (c) => c.query(
      `SELECT i.email, i.status, i.expires_at, o.name operator_name, r.name role_name, r.key role_key
       FROM invites i JOIN operators o ON o.id=i.operator_id JOIN roles r ON r.id=i.role_id WHERE i.token_hash=$1`,
      [tokenHash(token)]));
    const i = rows[0];
    if (!i) throw new ApiError(404, 'invite not found');
    const expired = i.status === 'pending' && new Date(i.expires_at) < new Date();
    return { email: i.email, operatorName: i.operator_name, roleName: i.role_name, roleKey: i.role_key,
      status: expired ? 'expired' : i.status, mfaRequired: ['owner', 'admin', 'technical'].includes(i.role_key) };
  }

  @Post('accept') async accept(@Body() body: unknown, @Req() req: Request) {
    const d = parse(AcceptIn, body);
    const inv = await withTenant('*', async (c) => {
      const q = await c.query(
        `SELECT i.*, r.key role_key FROM invites i JOIN roles r ON r.id=i.role_id
         WHERE i.token_hash=$1 AND i.status='pending' AND i.expires_at > now() FOR UPDATE OF i`,
        [tokenHash(d.token)]);
      if (!q.rows[0]) throw new ApiError(400, 'this invite is invalid, expired or already used');
      return q.rows[0];
    });
    const existing = await pool.query(`SELECT id FROM users WHERE email=$1`, [inv.email]);
    const userId = existing.rows[0]?.id
      ? existing.rows[0].id
      : (await pool.query(`INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id`,
          [inv.email, d.name, await pwdHash(d.password)])).rows[0].id;
    await withTenant(inv.operator_id, (c) => c.query(
      `INSERT INTO member_roles (user_id, operator_id, role_id, scope_type, site_id) VALUES ($1,$2,$3,$4,$5)`,
      [userId, inv.operator_id, inv.role_id, inv.scope_type, inv.site_id]));
    await withTenant('*', (c) => c.query(`UPDATE invites SET status='accepted', accepted_at=now() WHERE id=$1`, [inv.id]));
    await audit({ operatorId: inv.operator_id, userId, action: 'invite.accepted', entityType: 'invite', entityId: String(inv.id), ip: req.ip });
    if (['owner', 'admin', 'technical'].includes(inv.role_key)) {
      const { authenticator } = await import('otplib'); const QRCode = (await import('qrcode')).default;
      const secret = authenticator.generateSecret();
      await pool.query(`UPDATE users SET totp_secret_enc=$2 WHERE id=$1`, [userId, enc(secret)]);
      const otpauth = authenticator.keyuri(inv.email, 'T-Connect', secret);
      return { status: 'enroll', tempToken: hmacSign('enroll', userId, 900), secret, otpauth, qr: await QRCode.toDataURL(otpauth) };
    }
    return { status: 'ok' };
  }
}