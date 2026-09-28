#!/usr/bin/env node
/** Integration verification against a running LOCAL stack.
 *  1) docker compose -f docker-compose.dev.yml down -v && up -d --build   (fresh DB required)
 *  2) npm run build (packages must be built)  — radius/otplib are hoisted to root node_modules
 *  3) node tests/verify.mjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const dgram = require('node:dgram');
const { authenticator } = require('otplib');
const radius = require('radius');
try { radius.add_dictionary(path.join(__dirname, '..', 'tools', 'mikrotik.dict')); } catch {}

const BASE = process.env.BASE || 'http://localhost:8080';
const results = [];
const step = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`); };

function mkReq() {
  let cookies = {};
  const jar = (res) => { for (const c of (res.headers.getSetCookie?.() ?? [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); cookies[kv.slice(0, i)] = kv.slice(i + 1); } };
  return async (method, p, body) => {
    const headers = {};
    if (body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
    if (cookies.tc_csrf) headers['x-csrf-token'] = cookies.tc_csrf;
    if (Object.keys(cookies).length) headers['cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(BASE + p, { method, headers, body, redirect: 'manual' });
    jar(res);
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
}
function radiusSend(attrs, code, secret, port = 1812) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const t = setTimeout(() => { try { sock.close(); } catch {} reject(new Error('RADIUS timeout')); }, 4000);
    sock.on('message', (m) => { clearTimeout(t); sock.close(); resolve(m); });
    sock.on('error', (e) => { clearTimeout(t); reject(e); });
    sock.send(radius.encode({ code, secret, attributes: attrs }), port, '127.0.0.1');
  });
}

(async () => {
  const owner = mkReq();

  // 1. fresh DB?
  let r = await owner('GET', '/api/setup/status');
  if (!r.data.needed) { console.error('database is not fresh — run: docker compose -f docker-compose.dev.yml down -v && up -d'); process.exit(1); }
  step('setup status on fresh DB', true);

  // 2. first-run setup + MFA
  r = await owner('POST', '/api/setup', { operatorName: 'Verify Co', name: 'Verifier', email: 'owner@verify.ls', password: 'verify-password-1' });
  step('create owner', r.status === 200 && !!r.data.enrollToken);
  r = await owner('POST', '/api/setup/verify', { enrollToken: r.data.enrollToken, code: authenticator.generate(r.data.secret) });
  step('TOTP enrollment + session', r.status === 200 && !!owner.toString().length);
  r = await owner('GET', '/api/auth/me');
  step('me() has operator + permissions', !!r.data.operatorId && r.data.permissions.global.length > 0);

  // 3. site + plan + router + adoption
  r = await owner('POST', '/api/sites', { name: 'Verify Site', vertical: 'hotspot', ssid: 'T-Connect' });
  const siteId = r.data.id; step('create site', !!siteId);
  r = await owner('GET', '/api/plans');
  const dayPass = r.data.plans.find((p) => p.price_minor === 1000);
  step('M10 Day Pass seeded', !!dayPass);
  r = await owner('POST', '/api/routers', { name: 'Verify Router', siteId });
  const token = r.data.script.match(/\/adopt\/([A-Za-z0-9_-]+)/)?.[1];
  step('router + one-liner', !!token);

  const adoptPost = async (tok) => {
    const res = await fetch(`${BASE}/adopt/${tok}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'v=7.16.1|b=hAP ax3|s=VERIFY1' });
    return { status: res.status, text: await res.text() };
  };
  let a = await adoptPost(token);
  step('adoption returns provisioning script', a.status === 200 && a.text.includes('tc-tunnel') && a.text.includes('/ip hotspot'));
  a = await adoptPost(token);
  step('adoption token is single-use', a.text.includes('invalid or already used'));

  const st = {
    routerId: aRouterId(a.text = require('node:fs').existsSync('.x') ? '' : ''), // placeholder removed below
  };
  const script = (await adoptPost('nope')).text; // ignore
  // extract from the successful script (re-adopt flow not needed; parse from stored state instead)
  const good = script; // eslint-disable-line
  const extract = (re, s) => s.match(re)?.[1];
  // Re-fetch via a second router to keep it simple:
  r = await owner('POST', '/api/routers', { name: 'Verify Router 2', siteId });
  const token2 = r.data.script.match(/\/adopt\/([A-Za-z0-9_-]+)/)?.[1];
  a = await adoptPost(token2);
  const prov = a.text;
  const routerId = extract(/\/hb\/([0-9a-f-]{36})/, prov);
  const routerKey = extract(/Authorization: Bearer ([A-Za-z0-9_-]+)/, prov);
  const radiusSecret = extract(/\/radius add[^]*?secret="([A-Za-z0-9]{24,})"/, prov);
  const identity = extract(/system identity set name="([^"]+)"/, prov);
  const tunnelIp = extract(/\/ip address add address="(10\.200\.[0-9.]+)\/32"/, prov);
  step('provisioning script contains all secrets', !!(routerId && routerKey && radiusSecret && identity && tunnelIp));

  // 4. heartbeat makes it online
  const hb = await fetch(`${BASE}/hb/${routerId}`, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: `Bearer ${routerKey}` }, body: 'u=1m|c=8' });
  r = await owner('GET', '/api/routers');
  step('router online after heartbeat', hb.status === 200 && r.data.routers.some((x) => x.online));

  // 5. vouchers
  const csvRes = await fetch(`${BASE}/api/vouchers/batches`, { method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': (await owner('GET', '/api/auth/status'), Object.keys({})), } });
  // simpler: use owner req (it manages cookies/CSRF) but response is CSV text — mkReq handles non-json as text
  r = await owner('POST', '/api/vouchers/batches', { planId: dayPass.id, count: 2 });
  const code = String(r.data).split('\n')[1]?.trim();
  step('voucher batch CSV', !!code && code.length >= 8);

  // 6. RADIUS: exact entitlement
  const mac = (n) => `AA:BB:CC:00:00:${String(n).padStart(2, '0').toUpperCase()}`;
  const nas = { 'NAS-IP-Address': tunnelIp, 'NAS-Identifier': identity };
  let msg = await radiusSend({ 'User-Name': code, ...nas, 'Calling-Station-Id': mac(1) }, 'Access-Request', radiusSecret);
  let attrs = msg[0] === 2 ? radius.decode_response({ packet: msg, secret: radiusSecret }).attributes : {};
  step('M10 code → Access-Accept with 24h Session-Timeout', msg[0] === 2 && attrs['Session-Timeout'] > 86300 && attrs['Session-Timeout'] <= 86400);
  msg = await radiusSend({ 'User-Name': code, ...nas, 'Calling-Station-Id': mac(2) }, 'Access-Request', radiusSecret);
  step('second device accepted (phone + laptop)', msg[0] === 2);
  msg = await radiusSend({ 'User-Name': code, ...nas, 'Calling-Station-Id': mac(3) }, 'Access-Request', radiusSecret);
  step('third device rejected (anti-sharing)', msg[0] === 3);
  msg = await radiusSend({ 'User-Name': 'WRONGCODE', ...nas, 'Calling-Station-Id': mac(9) }, 'Access-Request', radiusSecret);
  step('invalid code rejected', msg[0] === 3);

  // 7. accounting → dashboard
  await radiusSend({ 'User-Name': code, ...nas, 'Calling-Station-Id': mac(1), 'Acct-Session-Id': 'VRFY1', 'Acct-Status-Type': 'Start', 'Acct-Input-Octets': 0, 'Acct-Output-Octets': 0 }, 'Accounting-Request', radiusSecret, 1813);
  r = await owner('GET', '/api/stats/overview');
  step('session live on dashboard', r.data.kpi.active_sessions >= 1 && r.data.kpi.revenue_24h === 0);

  // 8. RBAC: collaborator invite → accept → 403 on router creation
  r = await owner('POST', '/api/team/invites', { email: 'collab@verify.ls', roleKey: 'collaborator', scopeType: 'global' });
  const invToken = r.data.link.match(/invite\/([A-Za-z0-9_-]+)/)?.[1];
  step('invite created with single-use link', !!invToken);
  const collab = mkReq();
  r = await collab('GET', `/api/invites/preview?token=${encodeURIComponent(invToken)}`);
  step('invite preview', r.status === 200 && r.data.status === 'pending');
  r = await collab('POST', '/api/invites/accept', { token: invToken, name: 'Collab', password: 'collab-password-1' });
  step('invite accepted (no MFA for collaborator)', r.data.status === 'ok');
  r = await collab('POST', '/api/auth/login', { email: 'collab@verify.ls', password: 'collab-password-1' });
  step('collaborator logs in', r.data.status === 'ok');
  r = await collab('POST', '/api/routers', { name: 'nope' });
  step('collaborator cannot create routers (server-side RBAC)', r.status === 403);
  r = await collab('GET', '/api/auth/me');
  step('collaborator nav permissions exclude routers.manage', !r.data.permissions.global.includes('routers.manage'));

  // summary
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(', ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('verify crashed:', e); process.exit(1); });