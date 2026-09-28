import dgram from 'node:dgram';
import { createHash, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import radius from 'radius';
import { Pool } from 'pg';

try { radius.add_dictionary(path.join(__dirname, 'mikrotik.dict')); }
catch (e: any) { console.warn('[radius] mikrotik dictionary not loaded:', e.message); }

const PG = process.env.RADIUS_DATABASE_URL!;
const PEPPER = process.env.TOKEN_PEPPER!;
const KEY = Buffer.from(process.env.APP_ENCRYPTION_KEY!, 'base64');
const pool = new Pool({ connectionString: PG, max: 8 });

function dec(v: string): string {
  const [, iv, ct, tag] = v.split(':');
  const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
const codeHash = (c: string) => createHash('sha256').update(c.trim().toUpperCase() + PEPPER).digest('hex');

const routerCache = new Map<string, { id: string; operator_id: string; secret: string; at: number }>();
async function resolveRouter(nasId: string | undefined, nasIp: string | undefined) {
  const key = nasId || nasIp || '';
  const hit = routerCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const { rows } = await pool.query(
    `SELECT id, operator_id, radius_secret_enc, tunnel_ip FROM routers WHERE status='adopted' AND ($1 <> '' AND identity=$1 OR $2 <> '' AND tunnel_ip=$2) LIMIT 1`,
    [nasId ?? '', nasIp ?? '']);
  if (!rows[0]) return null;
  const r = { id: rows[0].id, operator_id: rows[0].operator_id, secret: dec(rows[0].radius_secret_enc), at: Date.now() };
  routerCache.set(key, r);
  return r;
}

const auth = dgram.createSocket('udp4');
auth.bind(1812, () => console.log('[radius] auth :1812'));
const acct = dgram.createSocket('udp4');
acct.bind(1813, () => console.log('[radius] acct :1813'));

async function handleAuth(msg: Buffer, rinfo: dgram.RemoteInfo, sock: dgram.Socket) {
  let peek: any;
  try { peek = radius.decode({ packet: msg, secret: 'peek' }); } catch { return; }
  const router = await resolveRouter(peek.attributes['NAS-Identifier'], peek.attributes['NAS-IP-Address']);
  const reject = async (username: string, reason: string, opId: string | null) => {
    await pool.query(`INSERT INTO auth_log (operator_id, router_id, username, result, reason) VALUES ($1,$2,$3,'reject',$4)`,
      [opId ?? router?.operator_id ?? null, router?.id ?? null, username ?? '', reason]).catch(() => {});
    if (router) sock.send(radius.encode_response({ packet: msg as any, code: 'Access-Reject', secret: router.secret }), rinfo.port, rinfo.address);
  };
  if (!router) return;

  const pkt = radius.decode({ packet: msg, secret: router.secret });
  const code = String(pkt.attributes['User-Name'] ?? '').trim();
  const mac = String(pkt.attributes['Calling-Station-Id'] ?? '').replace(/-/g, ':').toUpperCase();
  if (!code) return reject(code, 'no username', router.operator_id);

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `SELECT v.id, v.status, v.activated_at, v.expires_at,
              p.duration_seconds, p.data_cap_mb, p.rate_down_kbps, p.rate_up_kbps, p.burst_down_kbps, p.burst_up_kbps,
              p.max_devices, p.max_concurrent_sessions, p.idle_timeout_s, p.activation
       FROM vouchers v JOIN plans p ON p.id = v.plan_id WHERE v.code_hash = $1 FOR UPDATE OF v`,
      [codeHash(code)]);
    const v = rows[0];
    if (!v) { await c.query('COMMIT'); return reject(code, 'invalid code', router.operator_id); }
    if (v.status === 'revoked') { await c.query('COMMIT'); return reject(code, 'revoked', router.operator_id); }

    // atomic activation: exactly one concurrent request can flip unused -> active
    if (v.status === 'unused') {
      const act = await c.query(
        `UPDATE vouchers SET status='active', activated_at=now(),
           expires_at = CASE
             WHEN $2 = 'on_issue' THEN vouchers.expires_at
             WHEN $3 IS NOT NULL THEN now() + make_interval(secs => $3)
             ELSE NULL END
         WHERE vouchers.id = $1 AND vouchers.status = 'unused'
         RETURNING expires_at, activated_at`,
        [v.id, v.activation, v.duration_seconds]);
      if (act.rows[0]) { v.expires_at = act.rows[0].expires_at; v.activated_at = act.rows[0].activated_at; v.status = 'active'; }
    }
    if (v.status !== 'active') { await c.query('COMMIT'); return reject(code, `status ${v.status}`, router.operator_id); }
    if (v.expires_at && new Date(v.expires_at) < new Date()) {
      await c.query(`UPDATE vouchers SET status='expired' WHERE id=$1`, [v.id]);
      await c.query('COMMIT'); return reject(code, 'expired', router.operator_id);
    }

    // data cap — central usage across ALL sites (roaming-safe)
    if (v.data_cap_mb) {
      const used = await c.query(`SELECT coalesce(sum(bytes_in+bytes_out),0)::bigint u FROM radius_sessions WHERE voucher_id=$1`, [v.id]);
      if (Number(used.rows[0].u) >= v.data_cap_mb * 1024 * 1024) {
        await c.query(`UPDATE vouchers SET status='expired' WHERE id=$1`, [v.id]);
        await c.query('COMMIT'); return reject(code, 'data cap reached', router.operator_id);
      }
    }

    // device slots (default 2: phone + laptop) — enforced centrally
    await c.query(`INSERT INTO voucher_devices (voucher_id, mac) VALUES ($1,$2) ON CONFLICT (voucher_id, mac) DO UPDATE SET last_seen_at=now()`, [v.id, mac]);
    const dev = await c.query(`SELECT count(*)::int n FROM voucher_devices WHERE voucher_id=$1 AND mac <> $2`, [v.id, mac]);
    const mine = await c.query(`SELECT 1 FROM voucher_devices WHERE voucher_id=$1 AND mac=$2`, [v.id, mac]);
    if (Number(dev.rows[0].n) >= v.max_devices && !mine.rowCount) {
      await c.query('COMMIT'); return reject(code, 'device limit reached', router.operator_id);
    }

    // concurrent sessions across every router (roaming rules hold globally)
    const conc = await c.query(
      `SELECT count(*)::int n FROM radius_sessions WHERE voucher_id=$1 AND closed_at IS NULL AND mac <> $2`, [v.id, mac]);
    const myOpen = await c.query(
      `SELECT 1 FROM radius_sessions WHERE voucher_id=$1 AND closed_at IS NULL AND mac=$2 LIMIT 1`, [v.id, mac]);
    if (Number(conc.rows[0].n) >= v.max_concurrent_sessions && !myOpen.rowCount) {
      await c.query('COMMIT'); return reject(code, 'too many concurrent sessions', router.operator_id);
    }
    await c.query('COMMIT');

    await c.query(`INSERT INTO auth_log (operator_id, router_id, username, result) VALUES ($1,$2,$3,'ok')`,
      [router.operator_id, router.id, code]).catch(() => {});

    const attrs: Record<string, string | number> = { 'Idle-Timeout': v.idle_timeout_s, 'Acct-Interim-Interval': 120 };
    if (v.rate_down_kbps || v.rate_up_kbps) {
      const dn = v.rate_down_kbps ?? v.rate_up_kbps, up = v.rate_up_kbps ?? v.rate_down_kbps;
      attrs['Mikrotik-Rate-Limit'] = (v.burst_down_kbps || v.burst_up_kbps)
        ? `${dn}k/${up}k ${v.burst_down_kbps ?? dn}k/${v.burst_up_kbps ?? up}k ${Math.round(dn * 0.8)}k/${Math.round(up * 0.8)}k 8s/8s`
        : `${dn}k/${up}k`;
    }
    if (v.expires_at) attrs['Session-Timeout'] = Math.max(60, Math.floor((new Date(v.expires_at).getTime() - Date.now()) / 1000));
    if (v.data_cap_mb) {
      const used = await pool.query(`SELECT coalesce(sum(bytes_in+bytes_out),0)::bigint u FROM radius_sessions WHERE voucher_id=$1`, [v.id]);
      attrs['Mikrotik-Total-Limit'] = Math.max(1, v.data_cap_mb * 1024 * 1024 - Number(used.rows[0].u));
    }
    sock.send(radius.encode_response({ packet: msg as any, code: 'Access-Accept', secret: router.secret, attributes: attrs }), rinfo.port, rinfo.address);
  } finally { c.release(); }
}

async function handleAcct(msg: Buffer, rinfo: dgram.RemoteInfo, sock: dgram.Socket) {
  let peek: any;
  try { peek = radius.decode({ packet: msg, secret: 'peek' }); } catch { return; }
  const router = await resolveRouter(peek.attributes['NAS-Identifier'], peek.attributes['NAS-IP-Address']);
  if (!router) return;
  const pkt = radius.decode({ packet: msg, secret: router.secret });
  const a: any = pkt.attributes;
  const sid = String(a['Acct-Session-Id'] ?? '');
  const type = String(a['Acct-Status-Type'] ?? '');
  if (!sid || !['Start', 'Interim-Update', 'Stop'].includes(type)) {
    return sock.send(radius.encode_response({ packet: msg as any, code: 'Accounting-Response', secret: router.secret }), rinfo.port, rinfo.address);
  }
  const gig = (n: any, g: any) => (Number(n) || 0) + (Number(g) || 0) * 4294967296;
  const bytesIn = gig(a['Acct-Input-Octets'], a['Acct-Input-Gigawords']);
  const bytesOut = gig(a['Acct-Output-Octets'], a['Acct-Output-Gigawords']);
  const code = String(a['User-Name'] ?? '');
  const mac = String(a['Calling-Station-Id'] ?? '').replace(/-/g, ':').toUpperCase();
  const { rows } = await pool.query(`SELECT id FROM vouchers WHERE code_hash=$1`, [codeHash(code)]);
  const voucherId = rows[0]?.id ?? null;
  // idempotent upsert: duplicate Start / interim retransmits never double-count (GREATEST on counters)
  await pool.query(
    `INSERT INTO radius_sessions (operator_id, router_id, voucher_id, session_id, username, mac, framed_ip, bytes_in, bytes_out, closed_at, last_update)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10='Stop' THEN now() END, now())
     ON CONFLICT (router_id, session_id) DO UPDATE SET
       bytes_in = GREATEST(radius_sessions.bytes_in, EXCLUDED.bytes_in),
       bytes_out = GREATEST(radius_sessions.bytes_out, EXCLUDED.bytes_out),
       closed_at = COALESCE(radius_sessions.closed_at, EXCLUDED.closed_at),
       last_update = now(), voucher_id = COALESCE(EXCLUDED.voucher_id, radius_sessions.voucher_id)`,
    [router.operator_id, router.id, voucherId, sid, code, mac, String(a['Framed-IP-Address'] ?? '') || null, bytesIn, bytesOut, type]);
  sock.send(radius.encode_response({ packet: msg as any, code: 'Accounting-Response', secret: router.secret }), rinfo.port, rinfo.address);
}

auth.on('message', (m, r) => handleAuth(m, r, auth).catch((e) => console.error('[radius auth]', e)));
acct.on('message', (m, r) => handleAcct(m, r, acct).catch((e) => console.error('[radius acct]', e)));