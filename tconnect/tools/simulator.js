#!/usr/bin/env node
/** T-Connect local simulator: one adopted hAP ax3 + client devices, over real HTTP + real RADIUS. */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const dgram = require('node:dgram');
const radius = require('radius');
try { radius.add_dictionary(path.join(__dirname, 'mikrotik.dict')); } catch {}

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;

const BASE = String(args.base || 'http://localhost:8080');
const STATE = path.join(__dirname, args.state || '.router-state.json');
const log = (...m) => console.log('\x1b[36m[sim]\x1b[0m', ...m);
const ok = (...m) => console.log('\x1b[32m  ✓\x1b[0m', ...m);
const bad = (...m) => console.log('\x1b[31m  ✗\x1b[0m', ...m);

async function post(p, body, headers = {}) {
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body });
  return { status: res.status, text: await res.text() };
}
function parseScript(s) {
  const get = (re) => s.match(re)?.[1];
  const out = {
    routerId: get(/\/hb\/([0-9a-f-]{36})/),
    routerKey: get(/Authorization: Bearer ([A-Za-z0-9_-]+)/),
    radiusSecret: get(/\/radius add[^]*?secret="([A-Za-z0-9]{24,})"/),
    identity: get(/system identity set name="([^"]+)"/),
    tunnelIp: get(/\/ip address add address="(10\.200\.[0-9.]+)\/32"/),
  };
  for (const [k, v] of Object.entries(out)) if (!v) throw new Error(`could not extract ${k} from provisioning script`);
  return out;
}
const randMac = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join(':');

function radiusSend(attrs, code, secret, port = 1812) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => { try { sock.close(); } catch {} reject(new Error('RADIUS timeout - is the radius container up with 1812/udp mapped?')); }, 4000);
    sock.on('message', (msg) => { clearTimeout(timer); sock.close(); resolve(msg); });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.send(radius.encode({ code, secret, attributes: attrs }), port, '127.0.0.1');
  });
}

async function heartbeat(st) {
  const r = await post(`/hb/${st.routerId}`, `u=2h13m|c=${5 + Math.floor(Math.random() * 20)}`, { authorization: `Bearer ${st.routerKey}` });
  if (r.status !== 200) bad(`heartbeat failed (${r.status})`);
}

async function cmdAdopt() {
  let token = args.token;
  if (!token) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('Paste the adoption one-liner from the dashboard (empty line to submit):');
    const lines = [];
    for await (const l of rl) { if (!l.trim()) break; lines.push(l); }
    rl.close();
    token = lines.join(' ').match(/\/adopt\/([A-Za-z0-9_-]+)/)?.[1];
  }
  if (!token) return bad('no adoption token found');
  log(`adopting via ${BASE}/adopt/${token.slice(0, 8)}…`);
  const r = await post(`/adopt/${token}`, `v=7.16.1|b=hAP ax3|s=SIM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  if (/adoption-rejected|unsupported RouterOS|invalid or already used/.test(r.text)) return bad(r.text.replace(/:log error |;$/g, '').slice(0, 200));
  if (r.status !== 200) return bad(`adoption rejected (HTTP ${r.status})`);
  const st = parseScript(r.text);
  fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
  ok(`router adopted: ${st.identity} (tunnel ${st.tunnelIp}) - state saved to ${path.basename(STATE)}`);
  log('heartbeats every 25s (Ctrl+C to stop; the router stays "online" for 180s after the last one)');
  await heartbeat(st);
  setInterval(() => heartbeat(st).catch(() => {}), 25000);
}

async function cmdConnect() {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const code = String(args.code || '').trim().toUpperCase();
  if (!code) return bad('--code required (take one from the voucher CSV)');
  const mac = String(args.mac || randMac()).toUpperCase();
  log(`device ${mac} logging in with code ${code} → RADIUS 127.0.0.1:1812`);
  const msg = await radiusSend(
    { 'User-Name': code, 'NAS-IP-Address': st.tunnelIp, 'NAS-Identifier': st.identity, 'Calling-Station-Id': mac },
    'Access-Request', st.radiusSecret);
  if (msg[0] === 3) {
    bad('Access-Reject - code refused');
    console.log('    exact reason: docker compose -f docker-compose.dev.yml exec postgres psql -U tc_admin -d tconnect -c "SELECT username,result,reason FROM auth_log ORDER BY id DESC LIMIT 5"');
    process.exit(1);
  }
  if (msg[0] !== 2) return bad(`unexpected RADIUS reply code ${msg[0]}`);
  let attrs = {};
  try { attrs = radius.decode_response({ packet: msg, secret: st.radiusSecret }).attributes; } catch {}
  ok('Access-Accept - entitlement granted');
  for (const k of ['Mikrotik-Rate-Limit', 'Session-Timeout', 'Mikrotik-Total-Limit', 'Idle-Timeout', 'Acct-Interim-Interval'])
    if (attrs[k] !== undefined) console.log(`    ${k}: ${attrs[k]}`);
  const sid = Math.random().toString(16).slice(2, 10).toUpperCase();
  const acctAttrs = (type, inB, outB) => ({ 'User-Name': code, 'NAS-IP-Address': st.tunnelIp, 'NAS-Identifier': st.identity,
    'Calling-Station-Id': mac, 'Acct-Session-Id': sid, 'Acct-Status-Type': type, 'Acct-Input-Octets': inB, 'Acct-Output-Octets': outB });
  await radiusSend(acctAttrs('Start', 0, 0), 'Accounting-Request', st.radiusSecret, 1813);
  ok('Accounting Start - session is now live on the dashboard');
  let inB = 0, outB = 0;
  if (args.stay) {
    log('streaming usage every 15s (Ctrl+C to disconnect)');
    const iv = setInterval(async () => {
      inB += 3500000 + Math.floor(Math.random() * 2000000); outB += 900000;
      await radiusSend(acctAttrs('Interim-Update', inB, outB), 'Accounting-Request', st.radiusSecret, 1813);
      console.log(`    ↓ ${(inB / 1e6).toFixed(0)} MB   ↑ ${(outB / 1e6).toFixed(0)} MB`);
    }, 15000);
    process.on('SIGINT', async () => {
      clearInterval(iv);
      await radiusSend(acctAttrs('Stop', inB, outB), 'Accounting-Request', st.radiusSecret, 1813);
      ok('Accounting Stop - session closed'); process.exit(0);
    });
  } else {
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      inB += 12000000; outB += 3000000;
      await radiusSend(acctAttrs('Interim-Update', inB, outB), 'Accounting-Request', st.radiusSecret, 1813);
    }
    await radiusSend(acctAttrs('Stop', inB, outB), 'Accounting-Request', st.radiusSecret, 1813);
    ok(`session finished (≈${(inB / 1e6).toFixed(0)} MB down / ${(outB / 1e6).toFixed(0)} MB up)`);
  }
}

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'adopt') await cmdAdopt();
    else if (cmd === 'connect') await cmdConnect();
    else console.log(`usage:
  node tools/simulator.js adopt  [--base http://localhost:8080] [--token <id>] [--state .router-state.json]
  node tools/simulator.js connect --code XXXXXXXX [--mac AA:BB:CC:DD:EE:01] [--stay] [--state .router-state.json]`);
  } catch (e) { bad(e.message); process.exit(1); }
})();