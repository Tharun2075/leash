// Security of the demo console's approval endpoint: loopback only, Host/Origin pinned, per-session token, JSON body <= 4 KB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer, MAX_BODY } from './server.ts';
import type { LeashServer } from './server.ts';

let s: LeashServer;
before(async () => { s = await startServer(0); });
after(async () => { await s.close(); });

function call(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, method, path, headers: { host: `127.0.0.1:${s.port}`, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const good = () => ({ origin: `http://127.0.0.1:${s.port}`, 'x-leash-token': s.token, 'content-type': 'application/json' });
const decision = JSON.stringify({ step: 'sign', answer: 'approve' });

test('server binds to loopback only', () => {
  assert.equal((s.server.address() as { address: string }).address, '127.0.0.1');
});

test('page embeds the session token; token is random and long', async () => {
  const r = await call('GET', '/');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(`content="${s.token}"`));
  assert.match(s.token, /^[0-9a-f]{64}$/);
});

test('/decision without token, with a wrong token, from a foreign Origin or Host is refused', async () => {
  const noTok = { ...good() } as Record<string, string>; delete noTok['x-leash-token'];
  assert.equal((await call('POST', '/decision', noTok, decision)).status, 403);
  assert.equal((await call('POST', '/decision', { ...good(), 'x-leash-token': 'f'.repeat(64) }, decision)).status, 403);
  assert.equal((await call('POST', '/decision', { ...good(), origin: 'http://evil.example' }, decision)).status, 403);
  const noOrigin = { ...good() } as Record<string, string>; delete noOrigin.origin;
  assert.equal((await call('POST', '/decision', noOrigin, decision)).status, 403);
  assert.equal((await call('POST', '/decision', { ...good(), host: `evil.example:${s.port}` }, decision)).status, 403);
  assert.equal((await call('GET', '/', { host: 'rebind.example' })).status, 403);
});

test('/decision rejects query params, non-JSON and bodies over 4 KB', async () => {
  assert.equal((await call('POST', '/decision?step=sign&answer=approve', good(), decision)).status, 400);
  assert.equal((await call('POST', '/decision', { ...good(), 'content-type': 'text/plain' }, decision)).status, 415);
  const big = JSON.stringify({ step: 'sign', answer: 'approve', pad: 'x'.repeat(MAX_BODY) });
  assert.equal((await call('POST', '/decision', good(), big)).status, 413);
  assert.equal((await call('POST', '/decision', good(), JSON.stringify({ step: 'sign', answer: 'yes' }))).status, 400);
});

test('a valid request reaches the handler (409: nothing is waiting)', async () => {
  assert.equal((await call('POST', '/decision', good(), decision)).status, 409);
});

test('/events needs the token', async () => {
  assert.equal((await call('GET', '/events')).status, 403);
});
