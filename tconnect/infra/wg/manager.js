const http = require('node:http');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const TOKEN = process.env.WG_MANAGER_TOKEN;
const CONF = '/etc/wireguard/wg0.conf';
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sync() {
  execSync('wg-quick strip wg0 > /tmp/wg.sync && wg setconf wg0 /tmp/wg.sync', { stdio: 'pipe' });
}
function addPeer(publicKey, allowedIp) {
  let conf = fs.readFileSync(CONF, 'utf8');
  conf = conf.replace(new RegExp(`\\n\\[Peer\\]\\nPublicKey = ${rx(publicKey)}\\n[^\\[]*`, 'g'), '\n');
  conf = conf.replace(new RegExp(`\\n\\[Peer\\]\\n((?!PublicKey)[^\\[])*)PublicKey = [^\\n]*\\nAllowedIPs = ${rx(allowedIp)}\\n`, 'g'), '\n');
  conf = conf.trimEnd() + `\n\n[Peer]\nPublicKey = ${publicKey}\nAllowedIPs = ${allowedIp}\n`;
  fs.writeFileSync(CONF, conf);
  sync();
}
function removePeer(publicKey) {
  let conf = fs.readFileSync(CONF, 'utf8');
  conf = conf.replace(new RegExp(`\\n\\[Peer\\]\\nPublicKey = ${rx(publicKey)}\\n[^\\[]*`, 'g'), '\n');
  fs.writeFileSync(CONF, conf.trimEnd() + '\n');
  sync();
}

http.createServer((req, res) => {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, serverPubKey: fs.readFileSync('/etc/wireguard/server.pub', 'utf8').trim() }));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { publicKey, allowedIp } = JSON.parse(body || '{}');
      if (!publicKey || !allowedIp) throw new Error('publicKey/allowedIp required');
      if (req.method === 'POST') { addPeer(publicKey, allowedIp); return res.writeHead(200).end('{"ok":true}'); }
      if (req.method === 'DELETE') { removePeer(publicKey); return res.writeHead(200).end('{"ok":true}'); }
      res.writeHead(404).end();
    } catch (e) { res.writeHead(400).end(JSON.stringify({ error: String(e.message) })); }
  });
}).listen(8080, () => console.log('wg-manager on :8080'));