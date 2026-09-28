import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { withTenant } from './lib/db';
import { parse, audit } from './lib/http';
import { ApiError } from './lib/errors';
import { Auth, RequirePerm, Actor } from './guards';
import { VERTICALS } from '@tconnect/shared';

const SiteIn = z.object({
  name: z.string().min(2), vertical: z.enum(VERTICALS), ssid: z.string().max(32).optional().nullable(),
  address: z.string().optional(), lat: z.number().optional(), lng: z.number().optional(),
});

@Auth() @Controller('api/sites') export class SitesController {
  @Get() @RequirePerm('sites.read') async list(@Actor() a: Actor) {
    const scope = a.siteFilter();
    const rows = await withTenant(a.operatorId, (c) => c.query(
      `SELECT s.*, (SELECT count(*)::int FROM routers r WHERE r.site_id = s.id AND r.status <> 'retired') routers,
              (SELECT count(*)::int FROM radius_sessions rs JOIN routers r2 ON r2.id = rs.router_id
               WHERE r2.site_id = s.id AND rs.closed_at IS NULL) active_sessions
       FROM sites s ORDER BY s.created_at DESC`));
    return { sites: rows.rows.filter((s: any) => scope === 'all' || (scope as number[]).includes(s.id)) };
  }

  @Post() @RequirePerm('sites.manage') async create(@Actor() a: Actor, @Body() body: unknown) {
    const d = parse(SiteIn, body);
    const r = await withTenant(a.operatorId, (c) => c.query(
      `INSERT INTO sites (operator_id, name, vertical, ssid, address, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [a.operatorId, d.name, d.vertical, d.ssid ?? null, d.address ?? null, d.lat ?? null, d.lng ?? null]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'site.create', entityType: 'site', entityId: r.rows[0].id, data: d });
    return r.rows[0];
  }

  @Patch(':id') @RequirePerm('sites.manage') async update(@Actor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const d = parse(SiteIn.partial(), body);
    const r = await withTenant(a.operatorId, (c) => c.query(
      `UPDATE sites SET name=COALESCE($2,name), vertical=COALESCE($3,vertical), ssid=COALESCE($4,ssid),
        address=COALESCE($5,address), lat=COALESCE($6,lat), lng=COALESCE($7,lng)
       WHERE id=$8 RETURNING *`,
      [a.operatorId, d.name ?? null, d.vertical ?? null, d.ssid ?? null, d.address ?? null, d.lat ?? null, d.lng ?? null, Number(id)]));
    if (!r.rows[0]) throw new ApiError(404, 'site not found');
    if (d.ssid !== undefined)   // SSID change => routers re-apply config within their 30s agent cycle
      await withTenant(a.operatorId, (c) => c.query(
        `UPDATE routers SET config_revision = config_revision + 1 WHERE site_id=$1 AND status <> 'retired'`, [Number(id)]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'site.update', entityType: 'site', entityId: id, data: d });
    return r.rows[0];
  }

  @Delete(':id') @RequirePerm('sites.manage') async remove(@Actor() a: Actor, @Param('id') id: string) {
    await withTenant(a.operatorId, (c) => c.query(`DELETE FROM sites WHERE id=$1`, [Number(id)]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'site.delete', entityType: 'site', entityId: id });
    return { ok: true };
  }
}