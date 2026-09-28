import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { withTenant } from './lib/db';
import { parse, audit } from './lib/http';
import { Auth, RequirePerm, Actor } from './guards';
import { PERMISSIONS } from '@tconnect/shared';

const RoleIn = z.object({ name: z.string().min(2), perms: z.array(z.enum(PERMISSIONS)) });

@Auth() @Controller('api/roles') export class RolesController {
  @Get() @RequirePerm('team.read') async list(@Actor() a: Actor) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(
      `SELECT r.id, r.key, r.name, r.is_system, coalesce(json_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '[]') perms
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id
       WHERE r.operator_id=$1 GROUP BY r.id ORDER BY r.is_system DESC, r.name`, [a.operatorId]));
    return { roles: rows, allPermissions: PERMISSIONS };
  }
  @Post() @RequirePerm('roles.manage') async create(@Actor() a: Actor, @Body() body: unknown) {
    const d = parse(RoleIn, body);
    const r = await withTenant(a.operatorId, async (c) => {
      const key = 'custom-' + d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const role = await c.query(`INSERT INTO roles (operator_id, key, name, is_system) VALUES ($1,$2,$3,false) RETURNING id`, [a.operatorId, key, d.name]);
      for (const p of d.perms) await c.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2)`, [role.rows[0].id, p]);
      return role.rows[0];
    });
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'role.create', entityType: 'role', entityId: String(r.id), data: d });
    return { id: r.id };
  }
  @Delete(':id') @RequirePerm('roles.manage') async remove(@Actor() a: Actor, @Param('id') id: string) {
    await withTenant(a.operatorId, (c) => c.query(`DELETE FROM roles WHERE id=$1 AND is_system=false`, [Number(id)]));
    return { ok: true };
  }
}