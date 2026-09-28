import { CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { pool, withTenant } from './lib/db';
import { tokenHash } from './lib/crypto';
import { ApiError } from './lib/errors';
import { PERMISSIONS, Permission } from '@tconnect/shared';

export const Public = () => SetMetadata('public', true);
export const RequirePerm = (p: Permission) => SetMetadata('perm', p);
export const Actor = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().actor);

export interface Actor {
  userId: string; email: string; isPlatformOwner: boolean;
  operatorId: string | null;
  sessionId: string; csrf: string;
  perms: { global: Set<string>; sites: Map<number, Set<string>> };
  has(p: string, siteId?: number): boolean;
  siteFilter(): 'all' | number[];
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private ref: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (this.ref.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()])) return true;
    const sid = req.cookies?.tc_sid;
    if (!sid) throw new ApiError(401, 'not signed in');
    const { rows } = await pool.query(
      `SELECT s.id session_id, s.csrf, s.current_operator_id, u.id user_id, u.email, u.is_platform_owner
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now() AND s.last_used_at > now() - interval '12 hours'`,
      [tokenHash(sid)]);
    const r = rows[0];
    if (!r) throw new ApiError(401, 'session expired');
    await pool.query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [r.session_id]);
    const operatorId: string | null = r.current_operator_id ?? null;
    const perms = { global: new Set<string>(), sites: new Map<number, Set<string>>() };
    if (r.is_platform_owner) { for (const p of PERMISSIONS) perms.global.add(p); }
    else if (operatorId) {
      const pr = await withTenant(operatorId, (c) => c.query(
        `SELECT mr.scope_type, mr.site_id, rp.permission_key FROM member_roles mr
         JOIN roles r2 ON r2.id = mr.role_id JOIN role_permissions rp ON rp.role_id = r2.id
         WHERE mr.user_id = $1 AND mr.operator_id = $2`, [r.user_id, operatorId]));
      for (const row of pr.rows) {
        if (row.scope_type === 'global') perms.global.add(row.permission_key);
        else { const s = perms.sites.get(row.site_id) ?? new Set(); s.add(row.permission_key); perms.sites.set(row.site_id, s); }
      }
    }
    req.actor = {
      userId: r.user_id, email: r.email, isPlatformOwner: r.is_platform_owner,
      operatorId, sessionId: r.session_id, csrf: r.csrf, perms,
      has(p, siteId) {
        if (this.perms.global.has(p)) return true;
        if (siteId != null) return this.perms.sites.get(siteId)?.has(p) ?? false;
        return [...this.perms.sites.values()].some((s) => s.has(p));
      },
      siteFilter() {
        if (this.perms.global.size > 0 || this.isPlatformOwner) return 'all';
        return [...this.perms.sites.keys()];
      },
    } as Actor;
    return true;
  }
}

@Injectable()
export class PermGuard implements CanActivate {
  constructor(private ref: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const perm = this.ref.getAllAndOverride<string>('perm', [ctx.getHandler(), ctx.getClass()]);
    if (!perm) return true;
    const actor = ctx.switchToHttp().getRequest().actor as Actor | undefined;
    if (!actor) return false;
    if (!actor.has(perm)) throw new ApiError(403, 'you do not have permission for this action');
    return true;
  }
}
export const Auth = UseGuards(SessionGuard, PermGuard);