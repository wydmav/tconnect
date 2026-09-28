import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { withTenant } from './lib/db';
import { Auth, RequirePerm, Actor } from './guards';

@Auth() @Controller('api/stats') export class StatsController {
  @Get('overview') @RequirePerm('analytics.read') async overview(@Actor() a: Actor) {
    return withTenant(a.operatorId, async (c) => {
      const kpi = (await c.query(`
        SELECT
          (SELECT count(*)::int FROM radius_sessions WHERE closed_at IS NULL) active_sessions,
          (SELECT count(*)::int FROM radius_sessions WHERE started_at > now() - interval '24 hours') sessions_24h,
          (SELECT coalesce(sum(bytes_in+bytes_out),0)::bigint FROM radius_sessions WHERE last_update > now() - interval '24 hours') bytes_24h,
          (SELECT count(*)::int FROM routers WHERE status='adopted' AND last_seen_at > now() - interval '180 seconds') routers_online,
          (SELECT count(*)::int FROM routers WHERE status='adopted') routers_total,
          (SELECT coalesce(sum(amount_minor),0)::bigint FROM ledger_entries WHERE created_at > now() - interval '24 hours') revenue_24h,
          (SELECT count(*)::int FROM vouchers WHERE status='unused') vouchers_unused,
          (SELECT count(*)::int FROM vouchers WHERE status='active' AND expires_at > now()) vouchers_active,
          (SELECT count(*)::int FILTER (WHERE result='ok') FROM auth_log WHERE created_at > now() - interval '24 hours') auth_ok,
          (SELECT count(*)::int FROM auth_log WHERE created_at > now() - interval '24 hours') auth_total`)).rows[0];
      const verticals = (await c.query(`
        SELECT s.vertical,
          count(DISTINCT r.id) FILTER (WHERE r.status = 'adopted')::int routers,
          count(DISTINCT rs.id) FILTER (WHERE rs.closed_at IS NULL)::int active_sessions
        FROM sites s
        LEFT JOIN routers r ON r.site_id = s.id
        LEFT JOIN radius_sessions rs ON rs.router_id = r.id
        GROUP BY s.vertical`)).rows;
      const byHour = (await c.query(`
        SELECT to_char(date_trunc('hour', started_at) AT TIME ZONE 'Africa/Maseru', 'HH24') h, s.vertical, count(*)::int n
        FROM radius_sessions rs JOIN routers r ON r.id=rs.router_id JOIN sites s ON s.id=r.site_id
        WHERE started_at > now() - interval '24 hours' GROUP BY 1,2`)).rows;
      const recent = (await c.query(`
        SELECT rs.mac, rs.username, rs.framed_ip, rs.bytes_in, rs.bytes_out, rs.started_at, rs.closed_at, rs.last_update,
          s.name site_name, s.vertical, r.name router_name, p.name plan_name, p.price_minor
        FROM radius_sessions rs
        LEFT JOIN routers r ON r.id=rs.router_id LEFT JOIN sites s ON s.id=r.site_id
        LEFT JOIN vouchers v ON v.id=rs.voucher_id LEFT JOIN plans p ON p.id=v.plan_id
        ORDER BY rs.started_at DESC LIMIT 15`)).rows;
      return { kpi, verticals, byHour, recentSessions: recent };
    });
  }

  @Get('audit') @RequirePerm('audit.read') async audit(@Actor() a: Actor) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(
      `SELECT al.action, al.entity_type, al.entity_id, al.data, al.ip, al.created_at, u.email actor
       FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.id DESC LIMIT 100`));
    return { entries: rows };
  }

  @Get('sessions.csv') @RequirePerm('analytics.read') async csv(@Actor() a: Actor, @Res() res: Response) {
    const { rows } = await withTenant(a.operatorId, (c) => c.query(`
      SELECT rs.started_at, rs.closed_at, rs.mac, rs.framed_ip, rs.bytes_in, rs.bytes_out, rs.username,
        r.name router_name, s.name site_name, p.name plan_name
      FROM radius_sessions rs LEFT JOIN routers r ON r.id=rs.router_id LEFT JOIN sites s ON s.id=r.site_id
      LEFT JOIN vouchers v ON v.id=rs.voucher_id LEFT JOIN plans p ON p.id=v.plan_id
      ORDER BY rs.started_at DESC LIMIT 5000`));
    const head = 'started_at,closed_at,mac,ip,bytes_in,bytes_out,code,router,site,plan';
    const body = rows.map((r: any) => [r.started_at, r.closed_at ?? '', r.mac ?? '', r.framed_ip ?? '', r.bytes_in, r.bytes_out,
      r.username ?? '', r.router_name ?? '', r.site_name ?? '', r.plan_name ?? ''].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', 'attachment; filename="tconnect-sessions.csv"');
    res.send(`${head}\n${body}\n`);
  }
}