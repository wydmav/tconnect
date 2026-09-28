import { PoolClient } from 'pg';
import { SYSTEM_ROLES } from '@tconnect/shared';

export async function seedOperator(c: PoolClient, operatorId: string) {
  for (const r of SYSTEM_ROLES) {
    const res = await c.query(
      `INSERT INTO roles (operator_id, key, name, is_system) VALUES ($1,$2,$3,true)
       ON CONFLICT (operator_id, key) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [operatorId, r.key, r.name]);
    await c.query(`DELETE FROM role_permissions WHERE role_id = $1`, [res.rows[0].id]);
    for (const p of r.perms)
      await c.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [res.rows[0].id, p]);
  }
  const plans = [
    { name: 'Day Pass', price: 1000, dur: 86400 },     // M10 / 24h  (OTT-aligned denominations)
    { name: 'Week Pass', price: 6000, dur: 604800 },   // M60 / 7d
    { name: 'Month Pass', price: 28000, dur: 2592000 } // M280 / 30d
  ];
  for (const p of plans)
    await c.query(
      `INSERT INTO plans (operator_id, name, price_minor, duration_seconds, max_devices, max_concurrent_sessions)
       VALUES ($1,$2,$3,$4,2,2)`, [operatorId, p.name, p.price, p.dur]);
}