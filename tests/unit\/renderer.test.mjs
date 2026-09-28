import { test } from 'node:test'; import assert from 'node:assert/strict';
import { oneLiner, provisionScript, ros } from '../../packages/routeros/dist/index.js';

test('one-liner embeds token and DNS/device-mode guards', () => {
  const s = oneLiner('app.tconnect.co.ls', 'TOK123');
  assert.ok(s.includes('/adopt/TOK123')); assert.ok(s.includes(':resolve "app.tconnect.co.ls"'));
  assert.ok(s.includes('device-mode')); assert.ok(!s.includes('\n'));
});
test('ros escapes quotes, backslashes, dollars', () => {
  assert.equal(ros('a"b\\c$d'), 'a\\"b\\\\c\\$d');
});
test('provision script keeps scheduler $vars literal and sets revision', () => {
  const s = provisionScript({ domain: 'app.x.ls', wgHost: 'hub.x.ls', routerId: 'r-1', shortId: 'abcd1234',
    apiUser: 'u', apiPass: 'p', wgPriv: 'k', serverPub: 'K', tunnelIp: '10.200.1.2',
    radiusSecret: 's', routerKey: 'rk', walled: { http: ['a.com'], ip: ['b.com'] } });
  assert.ok(s.includes('on-event=":global tcRev'));
  assert.ok(s.includes('\\$tcRev'));
  assert.ok(s.includes('walled-garden')); assert.ok(s.includes(':set tcRev 1'));
});
test('wgPort override lands in the peers line', () => {
  const s = provisionScript({ domain: 'app.x.ls', wgHost: 'hub.x.ls', routerId: 'r-1', shortId: 'ab',
    apiUser: 'u', apiPass: 'p', wgPriv: 'k', serverPub: 'K', tunnelIp: '10.200.1.2',
    radiusSecret: 's', routerKey: 'rk', walled: { http: [], ip: [] }, wgPort: 51821 });
  assert.ok(s.includes('endpoint-port="51821"'));
});