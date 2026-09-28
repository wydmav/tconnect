import { Body, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { withTenant } from './lib/db';
import { parse, audit } from './lib/http';
import { ApiError } from './lib/errors';
import { tokenHash, randomToken, randomAlnum, enc, dec, sha256 } from './lib/crypto';
import { oneLiner, provisionScript, configScript, agentEvent } from '@tconnect/routeros';
import { Auth, Public, RequirePerm, Actor } from './guards';
import { env } from './env';
import * as http from 'node:http';

const wgUrl = new URL(env.WG_MANAGER_URL);
const wgCall = (method: string, path: string, body?: any) => new Promise<any>((resolve, reject) => {
  const data = body ? JSON.stringify(body) : '';
  const req = http.request({ host: wgUrl.hostname, port: Number(wgUrl.port || 80), method, path, headers: {
    authorization: `Bearer ${env.WG_MANAGER_TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
    (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => {
      if (res.statusCode! >= 400) reject(new Error(`wg-manager ${path}: ${b}`)); else resolve(b ? JSON.parse(b) : {}); }); });
  req.on('error', reject); req.end(data);
});

function genWgKeypair(): { priv: string; pub: string } {
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64'),
    pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
  };
}

async function walledFor(c: any, operatorId: string | null) {
  const { rows } = await c.query(
    `SELECT kind, dst_host FROM walled_garden_entries WHERE enabled AND (operator_id IS NULL OR operator_id = $1) ORDER BY id`, [operatorId]);
  const w = { http: [env.DOMAIN], ip: [env.DOMAIN] };   // portal/API always allowed pre-auth
  for (const r of rows) (r.kind === 'http' ? w.http : w.ip).push(r.dst_host);
  return w;
}

@Auth() @Controller('api/routers') export class RoutersController {
  @Get() @RequirePerm('routers.read') async list(@Actor() a: Actor) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(
      `SELECT r.id, r.name, r.status, r.last_seen_at, r.uptime, r.cpu_load, r.ros_version, r.board_name, r.serial,
              r.tunnel_ip, r.config_revision, r.adopted_at,
              s.name site_name, s.vertical,
              (r.last_seen_at > now() - interval '180 seconds') online
       FROM routers r LEFT JOIN sites s ON s.id = r.site_id
       WHERE r.status <> 'retired' ORDER BY r.created_at DESC`));
    return { routers: rows };
  }

  @Post() @RequirePerm('routers.manage') async create(@Actor() a: Actor, @Body() body: unknown, @Req() req: Request) {
    const d = parse(z.object({ name: z.string().min(1).optional(), siteId: z.number().int().optional() }), body);
    if (d.siteId !== undefined) {
      const ok = await withTenant(a.operatorId, (c) => c.query(`SELECT 1 FROM sites WHERE id=$1`, [d.siteId!]));
      if (!ok.rowCount) throw new ApiError(404, 'site not found');
    }
    const router = await withTenant(a.operatorId, (c) => c.query(
      `INSERT INTO routers (operator_id, site_id, name, tunnel_num, identity, api_user)
       VALUES ($1,$2,$3, nextval('routers_tunnel_num_seq'), 'pending-' || gen_random_uuid()::text, 'pending')
       RETURNING id`, [a.operatorId, d.siteId ?? null, d.name ?? 'New router']));
    const token = randomToken(24);
    await withTenant(a.operatorId, (c) => c.query(
      `INSERT INTO adoption_tokens (operator_id, router_id, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '24 hours')`,
      [a.operatorId, router.rows[0].id, tokenHash(token), a.userId]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'router.create', entityType: 'router', entityId: router.rows[0].id, ip: req.ip });
    return { routerId: router.rows[0].id, script: oneLiner(env.DOMAIN, token) };
  }

  @Post(':id/readopt') @RequirePerm('routers.manage') async readopt(@Actor() a: Actor, @Param('id') id: string) {
    const exists = await withTenant(a.operatorId, (c) => c.query(`SELECT 1 FROM routers WHERE id=$1 AND status<>'retired'`, [id]));
    if (!exists.rowCount) throw new ApiError(404, 'router not found');
    const token = randomToken(24);
    await withTenant(a.operatorId, (c) => c.query(
      `INSERT INTO adoption_tokens (operator_id, router_id, token_hash, created_by, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '24 hours')`, [a.operatorId, id, tokenHash(token), a.userId]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'router.readopt', entityType: 'router', entityId: id });
    return { script: oneLiner(env.DOMAIN, token) };
  }

  @Post(':id/reconfigure') @RequirePerm('routers.manage') async reconfigure(@Actor() a: Actor, @Param('id') id: string) {
    const r = await withTenant(a.operatorId, (c) => c.query(
      `UPDATE routers SET config_revision = config_revision + 1 WHERE id=$1 AND status<>'retired' RETURNING config_revision`, [id]));
    if (!r.rows[0]) throw new ApiError(404, 'router not found');
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'router.reconfigure', entityType: 'router', entityId: id, data: { revision: r.rows[0].config_revision } });
    return { revision: r.rows[0].config_revision };
  }

  @Delete(':id') @RequirePerm('routers.manage') async remove(@Actor() a: Actor, @Param('id') id: string) {
    const r = await withTenant(a.operatorId, (c) => c.query(`SELECT wg_public_key FROM routers WHERE id=$1`, [id]));
    if (r.rows[0]?.wg_public_key) { try { await wgCall('DELETE', '/peers', { publicKey: r.rows[0].wg_public_key }); } catch {} }
    await withTenant(a.operatorId, (c) => c.query(`UPDATE routers SET status='retired' WHERE id=$1`, [id]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'router.retire', entityType: 'router', entityId: id });
    return { ok: true };
  }
}

/** Public: router POSTs version/board/serial with the single-use token; server replies with the personalized provisioning script. */
@Public() @Controller('adopt') export class AdoptController {
  @Post(':token') async adopt(@Param('token') token: string, @Body() info: string, @Req() req: Request, @Res() res: Response) {
    const parts = String(info ?? '').split('|').reduce((m: any, kv) => { const [k, ...v] = kv.split('='); m[k] = v.join('='); return m; }, {});
    const version = String(parts.v ?? ''); const board = String(parts.b ?? ''); const serial = String(parts.s ?? '');
    const [maj, min] = version.split('.').map(Number);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    const bad = (msg: string) => res.send(`:log error "T-Connect: ${msg.replace(/"/g, '')}"; :error "adoption-rejected";`);
    if (!(maj === 7 && min >= 13)) return bad(`unsupported RouterOS version "${version}" - requires v7.13+`);

    const t = await withTenant('*', async (c) => {
      const q = await c.query(`SELECT id, operator_id, router_id FROM adoption_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [tokenHash(token)]);
      if (!q.rows[0]) return null;
      const tok = q.rows[0];
      let routerId: string, tunnelNum: number, siteId: number | null = null;
      if (tok.router_id) {  // re-adoption: rotate all secrets, keep tunnel number
        const u = await c.query(`UPDATE routers SET config_revision = config_revision + 1 WHERE id=$1 RETURNING id, tunnel_num, site_id`, [tok.router_id]);
        if (!u.rows[0]) return null;
        routerId = u.rows[0].id; tunnelNum = u.rows[0].tunnel_num; siteId = u.rows[0].site_id;
      } else {
        const i = await c.query(`INSERT INTO routers (operator_id, site_id, name, status, tunnel_num, identity, api_user)
          VALUES ($1,$2,$3,'adopted', nextval('routers_tunnel_num_seq'), 'tmp', 'tmp') RETURNING id, tunnel_num, site_id`,
          [tok.operator_id, null, board || 'Router']);
        routerId = i.rows[0].id; tunnelNum = i.rows[0].tunnel_num; siteId = i.rows[0].site_id;
      }
      let ssid: string | undefined;
      if (siteId) ssid = (await c.query(`SELECT ssid FROM sites WHERE id=$1`, [siteId])).rows[0]?.ssid ?? undefined;
      const shortId = routerId.slice(0, 8);
      const keys = genWgKeypair();
      const apiUser = `tc-${shortId}`;
      const apiPass = randomAlnum(32, 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789');
      const routerKey = randomToken(24);
      const radiusSecret = randomAlnum(32, 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789');
      const tunnelIp = `10.200.${(tunnelNum % 254) + 1}.2`;
      const ev = agentEvent(env.DOMAIN, routerId, routerKey);   // pre-escaped scheduler line (contains the key) — stored encrypted
      await c.query(
        `UPDATE routers SET name=$2, identity=$3, board_name=$4, ros_version=$5, serial=$6, status='adopted',
           tunnel_ip=$7, wg_public_key=$8, api_user=$9, api_password_enc=$10, router_key_hash=$11, radius_secret_enc=$12,
           agent_line_enc=$13, adopted_at=now(), last_seen_at=now()
         WHERE id=$1`,
        [routerId, board || `Router ${shortId}`, `tc-${shortId}`, board, version, serial, tunnelIp,
         keys.pub, apiUser, enc(apiPass), sha256(routerKey + env.TOKEN_PEPPER), enc(radiusSecret), enc(ev)]);
      await c.query(`UPDATE adoption_tokens SET used_at=now(), router_id=$2 WHERE id=$1`, [tok.id, routerId]);
      return { operatorId: tok.operator_id as string, routerId, tunnelIp, keys, apiUser, apiPass, routerKey, radiusSecret, shortId, ssid, version, ev };
    });
    if (!t) return bad('adoption token invalid or already used - generate a new script in the dashboard');

    const serverPub = (await wgCall('GET', '/health')).serverPubKey;
    await wgCall('POST', '/peers', { publicKey: t.keys.pub, allowedIp: `${t.tunnelIp}/32` });   // upsert by AllowedIPs
    await audit({ operatorId: t.operatorId, userId: null, action: 'router.adopted', entityType: 'router', entityId: t.routerId,
      data: { version: t.version, board }, ip: req.ip });

    const walled = await withTenant(t.operatorId, (c) => walledFor(c, t.operatorId));
    res.send(provisionScript({
      domain: env.DOMAIN, wgHost: env.WG_HOST, wgPort: env.WG_PORT,
      routerId: t.routerId, shortId: t.shortId,
      apiUser: t.apiUser, apiPass: t.apiPass, wgPriv: t.keys.priv, serverPub,
      tunnelIp: t.tunnelIp, radiusSecret: t.radiusSecret, routerKey: t.routerKey, walled, ssid: t.ssid, agentEvent: t.ev,
    }));
  }
}

/** Router agent endpoints: heartbeat + config pull. Bearer = per-router key (hash-stored). */
@Public() @Controller() export class AgentController {
  @Post('hb/:routerId') async hb(@Param('routerId') routerId: string, @Body() data: string, @Req() req: Request) {
    const r = await authenticateRouter(req, routerId);
    const m = Object.fromEntries(String(data ?? '').split('&').map((kv) => kv.split('=')));
    await withTenant(r.operator_id, (c) => c.query(
      `UPDATE routers SET last_seen_at=now(), uptime=$2, cpu_load=$3 WHERE id=$1`,
      [r.id, decodeURIComponent(m.u ?? '').slice(0, 40), Number(m.c) || null]));
    return '';
  }

  @Post('cfg/:routerId') async cfg(@Param('routerId') routerId: string, @Body() data: string, @Req() req: Request, @Res() res: Response) {
    const r = await authenticateRouter(req, routerId);
    const rev = Number(String(data ?? '').split('=')[1]) || 0;
    if (rev === r.config_revision) return res.setHeader('content-type', 'text/plain').send('NOCHANGE');
    const script = await withTenant(r.operator_id, async (c) => {
      const s = await c.query(`SELECT ssid FROM sites WHERE id=$1`, [r.site_id]);
      const walled = await walledFor(c, r.operator_id);
      return configScript({ rev: r.config_revision, domain: env.DOMAIN, routerId: r.id,
        agentEvent: dec(r.agent_line_enc), walled, ssid: s.rows[0]?.ssid ?? undefined });
    });
    res.setHeader('content-type', 'text/plain').send(script);
  }
}

async function authenticateRouter(req: Request, routerId: string) {
  const key = (req.headers.authorization ?? '').replace('Bearer ', '');
  if (!key) throw new ApiError(401, 'unauthorized');
  const { rows } = await withTenant('*', (c) => c.query(
    `SELECT id, operator_id, site_id, config_revision, router_key_hash, agent_line_enc FROM routers WHERE id=$1 AND status='adopted'`, [routerId]));
  const r = rows[0];
  if (!r || r.router_key_hash !== sha256(key + env.TOKEN_PEPPER)) throw new ApiError(401, 'unauthorized');
  return r;
}