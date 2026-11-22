// "Why blocked" decoder: every Reason code becomes a plain sentence; raw PolicyBlocked revert data decodes too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeErrorResult } from 'viem';
import { request } from 'node:http';
import { VAULT_ABI } from './chain.ts';
import { REASONS } from './policy.ts';
import { whyBlocked } from './why.ts';
import { parseAgents, DEFAULT_AGENTS } from './budget.ts';
import { startServer } from './server.ts';

test('every Reason code has its own plain sentence, no enum names leak', () => {
  const seen = new Set<string>();
  REASONS.forEach((r, i) => {
    const w = whyBlocked(i);
    assert.equal(w.reason, r);
    assert.equal(w.blocked, r !== 'OK');
    assert.ok(!/[A-Z]{2,}_[A-Z]/.test(w.sentence), `enum name in: ${w.sentence}`);
    assert.ok(w.sentence.endsWith('.'));
    seen.add(w.sentence);
  });
  assert.equal(seen.size, REASONS.length);
});

test('number string, reason name and lower-case name give the same answer', () => {
  assert.deepEqual(whyBlocked('4'), whyBlocked(4));
  assert.deepEqual(whyBlocked('OVER_PER_PAYMENT'), whyBlocked(4));
  assert.deepEqual(whyBlocked(' over_daily_cap '), whyBlocked(5));
});

test('raw PolicyBlocked revert data (as on the mainnet blocked tx) decodes to reason 4', () => {
  const data = encodeErrorResult({ abi: VAULT_ABI, errorName: 'PolicyBlocked', args: [4] });
  const w = whyBlocked(data);
  assert.equal(w.code, 4);
  assert.equal(w.reason, 'OVER_PER_PAYMENT');
  assert.match(w.sentence, /one payment may not be larger/);
});

test('budget numbers are used when given', () => {
  assert.match(whyBlocked(4, { maxPerPayment: 5_000_000n }).sentence, /larger than 5\.00 USD/);
  assert.match(whyBlocked(5, { remainingToday: 1_500_000n, dailyCap: 50_000_000n }).sentence, /only 1\.50 USD of 50\.00 USD is left/);
  assert.match(whyBlocked(6, { cooldownSec: 30 }).sentence, /wait 30 s/);
});

test('unknown codes, other errors and garbage never throw and say so', () => {
  for (const bad of [7, 255, -1, 1.5, '', 'hello', '0x', '0xdeadbeef', '0x08c379a0']) {
    const w = whyBlocked(bad as number | string);
    assert.equal(w.reason, 'UNKNOWN', String(bad));
    assert.match(w.sentence, /^Unknown reason/);
  }
});

test('agent list parsing keeps at most 3 valid entries, falls back to defaults', () => {
  assert.equal(parseAgents(undefined), DEFAULT_AGENTS);
  assert.equal(parseAgents('x=nope'), DEFAULT_AGENTS);
  const a = '0x186d6E32EB784e3483acb56acc1c560Eeb49e368';
  assert.deepEqual(parseAgents(`A=${a},B=${a},C=${a},D=${a}`).map((x) => x.label), ['A', 'B', 'C']);
});

function get(port: number, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    }).on('error', reject).end();
  });
}

test('console serves /why and /budget (budget reader injected, cached, 502 on chain failure)', async () => {
  let calls = 0;
  const s = await startServer(0, { budget: async () => {
    calls++;
    return { chainId: 177, vault: '0x736076b308c720d38bb31bdf97e5726ab90f13a9', readAt: 'now', vaultUrl: 'u', agents: [] };
  } });
  try {
    const w = await get(s.port, '/why?q=4');
    assert.equal(JSON.parse(w.text).reason, 'OVER_PER_PAYMENT');
    assert.equal((await get(s.port, `/why?q=${'1'.repeat(201)}`)).status, 400);
    const b1 = await get(s.port, '/budget');
    assert.equal(b1.status, 200);
    assert.equal(JSON.parse(b1.text).chainId, 177);
    await get(s.port, '/budget');
    assert.equal(calls, 1, 'second read inside 5 s comes from cache');
    const s2 = await startServer(0, { budget: async () => { throw new Error('rpc down'); } });
    try { assert.equal((await get(s2.port, '/budget')).status, 502); } finally { await s2.close(); }
  } finally { await s.close(); }
});

test('UI "Real blocked tx" example is the exact revert data of the mainnet blocked payment', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  const data = encodeErrorResult({ abi: VAULT_ABI, errorName: 'PolicyBlocked', args: [4] });
  assert.ok(html.includes(`'${data}'`), 'BLOCKED_DATA in ui/index.html drifted from PolicyBlocked(4)');
});
