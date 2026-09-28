import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { withTenant } from './lib/db';
import { parse, audit } from './lib/http';
import { ApiError } from './lib/errors';
import { tokenHash, enc, randomAlnum } from './lib/crypto';
import { Auth, RequirePerm, Actor } from './guards';

const CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // no 0/O/1/I
const BatchIn = z.object({
  planId: z.number().int(), count: z.number().int().min(1).max(1000),
  prefix: z.string().regex(/^[A-Z0-9]{0,4}$/).optional(), note: z.string().max(200).optional(),
});

@Auth() @Controller('api/vouchers') export class VouchersController {
  @Post('batches') @RequirePerm('vouchers.manage') async createBatch(@Actor() a: Actor, @Body() body: unknown, @Res() res: Response) {
    const d = parse(BatchIn, body);
    const { codes, batchId } = await withTenant(a.operatorId, async (c) => {
      const plan = await c.query(`SELECT id, activation, duration_seconds FROM plans WHERE id=$1 AND operator_id=$2 AND enabled`,
        [d.planId, a.operatorId]);
      if (!plan.rows[0]) throw new ApiError(404, 'plan not found (or disabled)');
      const b = await c.query(
        `INSERT INTO voucher_batches (operator_id, plan_id, count, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [a.operatorId, d.planId, d.count, d.note ?? '', a.userId]);
      const out: string[] = [];
      for (let i = 0; i < d.count; i++) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = `${d.prefix ?? ''}${randomAlnum(8, CHARSET)}`.slice(0, 12);
          try {
            await c.query(
              `INSERT INTO vouchers (operator_id, batch_id, plan_id, code_hash, code_enc, expires_at)
               VALUES ($1,$2,$3,$4,$5, CASE WHEN $6 = 'on_issue' AND $7 IS NOT NULL THEN now() + make_interval(secs => $7) ELSE NULL END)`,
              [a.operatorId, b.rows[0].id, d.planId, tokenHash(code), enc(code), plan.rows[0].activation, plan.rows[0].duration_seconds]);
            out.push(code); break;
          } catch (e: any) { if (e.code !== '23505') throw e; }   // collision: retry with a new code
        }
      }
      return { codes: out, batchId: b.rows[0].id as number };
    });
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'voucher.batch.create', entityType: 'batch', entityId: String(batchId), data: { count: d.count, planId: d.planId } });
    const csv = 'code\n' + codes.join('\n') + '\n';
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', `attachment; filename="tconnect-batch-${batchId}.csv"`);
    res.send(csv);
  }

  @Get('batches') @RequirePerm('vouchers.read') async batches(@Actor() a: Actor) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(
      `SELECT b.*, p.name plan_name, p.price_minor, p.duration_seconds,
        (SELECT count(*)::int FROM vouchers v WHERE v.batch_id=b.id) total,
        (SELECT count(*)::int FROM vouchers v WHERE v.batch_id=b.id AND v.status='unused') unused,
        (SELECT count(*)::int FROM vouchers v WHERE v.batch_id=b.id AND v.status='active') active
       FROM voucher_batches b JOIN plans p ON p.id=b.plan_id ORDER BY b.created_at DESC LIMIT 100`));
    return { batches: rows };
  }

  @Post('batches/:id/revoke') @RequirePerm('vouchers.manage') async revoke(@Actor() a: Actor, @Param('id') id: string) {
    const r = await withTenant(a.operatorId, (c) => c.query(
      `UPDATE vouchers SET status='revoked' WHERE batch_id=$1 AND status='unused' RETURNING id`, [Number(id)]));
    await audit({ operatorId: a.operatorId, userId: a.userId, action: 'voucher.batch.revoke', entityType: 'batch', entityId: id, data: { revoked: r.rowCount } });
    return { revoked: r.rowCount };
  }
}