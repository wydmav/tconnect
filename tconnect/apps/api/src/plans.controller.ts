import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { withTenant } from './lib/db';
import { parse, audit } from './lib/http';
import { ApiError } from './lib/errors';
import { Auth, RequirePerm, Actor } from './guards';

const PlanIn = z.object({
  name: z.string().min(2), priceMinor: z.number().int().min(0),
  durationSeconds: z.number().int().positive().nullable().optional(),
  dataCapMb: z.number().int().positive().nullable().optional(),
  rateDownKbps: z.number().int().positive().nullable().optional(),
  rateUpKbps: z.number().int().positive().nullable().optional(),
  burstDownKbps: z.number().int().positive().nullable().optional(),
  burstUpKbps: z.number().int().positive().nullable().optional(),
  maxDevices: z.number().int().min(1).max(10).default(2),
  maxConcurrentSessions: z.number().int().min(1).max(10).default(2),
  idleTimeoutS: z.number().int().min(60).default(1800),
  activation: z.enum(['on_first_login', 'on_issue']).default('on_first_login'),
  enabled: z.boolean().default(true),
});

@Auth() @Controller('api/plans') export class PlansController {
  @Get() @RequirePerm('plans.read') async list(@Actor() a: Actor) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(`SELECT * FROM plans ORDER BY price_minor`));
    return { plans: rows };
  }
  @Post() @RequirePerm('plans.manage') async create(@Actor() a: Actor, @Body() body: unknown) {
    const d = parse(PlanIn, body);
    const r = await withTenant(a.operatorId, (c) => c.query(
      `INSERT INTO plans (operator_id, name, price_minor, duration_seconds, data_cap_mb, rate_down_kbps, rate_up_kbps,
        burst_down_kbps, burst_up_kbps, max_devices, max_concurrent_sessions, idle_timeout_s, activation, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [a.operatorId, d.name, d.priceMinor, d.durationSeconds ?? null, d.dataCapMb ?? null, d.rateDownKbps ?? null,
       d.rateUpKbps ?? null, d.burstDownKbps ?? null, d.burstUpKbps ?? null, d.maxDevices,
       d.maxConcurrentSessions, d.idleTimeoutS, d.activation, d.enabled]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'plan.create', entityType: 'plan', entityId: r.rows[0].id, data: d });
    return r.rows[0];
  }
  @Patch(':id') @RequirePerm('plans.manage') async update(@Actor() a: Actor, @Param('id') id: string, @Body() body: unknown) {
    const d = parse(PlanIn.partial(), body);
    const r = await withTenant(a.operatorId, (c) => c.query(
      `UPDATE plans SET name=COALESCE($2,name), price_minor=COALESCE($3,price_minor), duration_seconds=COALESCE($4,duration_seconds),
        data_cap_mb=COALESCE($5,data_cap_mb), rate_down_kbps=COALESCE($6,rate_down_kbps), rate_up_kbps=COALESCE($7,rate_up_kbps),
        burst_down_kbps=COALESCE($8,burst_down_kbps), burst_up_kbps=COALESCE($9,burst_up_kbps), max_devices=COALESCE($10,max_devices),
        max_concurrent_sessions=COALESCE($11,max_concurrent_sessions), idle_timeout_s=COALESCE($12,idle_timeout_s),
        activation=COALESCE($13,activation), enabled=COALESCE($14,enabled)
       WHERE id=$15 RETURNING *`,
      [a.operatorId ?? null, d.name ?? null, d.priceMinor ?? null, d.durationSeconds ?? null, d.dataCapMb ?? null,
       d.rateDownKbps ?? null, d.rateUpKbps ?? null, d.burstDownKbps ?? null, d.burstUpKbps ?? null,
       d.maxDevices ?? null, d.maxConcurrentSessions ?? null, d.idleTimeoutS ?? null, d.activation ?? null,
       d.enabled ?? null, Number(id)]));
    if (!r.rows[0]) throw new ApiError(404, 'plan not found');
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'plan.update', entityType: 'plan', entityId: id, data: d });
    return r.rows[0];
  }
  @Delete(':id') @RequirePerm('plans.manage') async remove(@Actor() a: Actor, @Param('id') id: string) {
    await withTenant(a.operatorId, (c) => c.query(`DELETE FROM plans WHERE id=$1`, [Number(id)]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'plan.delete', entityType: 'plan', entityId: id });
    return { ok: true };
  }
}