const http = require('node:http');
const TOKEN = process.env.WG_MANAGER_TOKEN || 'localdev';
http.createServer((req, res) => {
  if ((req.headers.authorization || '') !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, serverPubKey: 'x'.repeat(43) + '=' }));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { publicKey, allowedIp } = JSON.parse(body || '{}');
      if (req.method === 'POST' && publicKey && allowedIp) return res.writeHead(200).end('{"ok":true}');
      if (req.method === 'DELETE') return res.writeHead(200).end('{"ok":true}');
      res.writeHead(400).end();
    } catch { res.writeHead(400).end(); }
  });
}).listen(8080, () => console.log('[mock-wg] :8080 (local mode - WireGuard simulated)'));