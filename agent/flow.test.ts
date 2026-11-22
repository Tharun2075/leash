// T6 (a)-(f), T7, T8 from fable/IDEA.md TEST PLAN, run offline against MockHspAdapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { MockHspAdapter } from './hsp/mock.ts';
import type { MockScenario } from './hsp/mock.ts';
import { LocalVault } from './vault.ts';
import { MemoryJournal } from './journal.ts';
import { pay, resume, PENDING_AFTER_MS } from './flow.ts';
import type { FlowDeps, FlowEvent, Purchase } from './flow.ts';
import { dayOf } from './policy.ts';
import { HspError, errorCodeOf } from './hsp/types.ts';

const SELLER = '0x5e11e700000000000000000000000000000000a1';
const STRANGER = '0xbadbad0000000000000000000000000000000bad';
const USD = 1_000_000n;
const T0 = Date.parse('2026-11-22T10:00:00Z');

function setup(scenario: MockScenario = {}, decisions: Array<boolean | 'crash'> = [true, true, true, true, true, true]) {
  let nowMs = T0;
  const clock = { now: () => nowMs, sleep: async (ms: number) => { nowMs += ms; } };
  const hsp = new MockHspAdapter(scenario, clock.now);
  const vault = new LocalVault(
    { dailyCap: 50n * USD, maxPerPayment: 5n * USD, cooldownSec: 0, active: true, merchants: [SELLER] },
    () => Math.floor(nowMs / 1000),
  );
  const journal = new MemoryJournal();
  const events: FlowEvent[] = [];
  const asked: string[] = [];
  const account = privateKeyToAccount(generatePrivateKey()); // ephemeral demo key, never stored
  const signed: Array<{ at: number; validBefore: number }> = [];
  const deps: FlowDeps = {
    hsp, vault, journal, clock,
    emit: (e) => events.push(e),
    merchantName: 'Leash demo seller',
    wallet: {
      address: account.address,
      signTypedData: (d) => { signed.push({ at: nowMs, validBefore: Number(d.message.validBefore) }); return account.signTypedData(d as never); },
    },
    human: {
      decide: async (step) => {
        asked.push(step);
        const a = decisions.shift();
        if (a === 'crash') throw new Error('process killed');
        return a ?? false;
      },
    },
  };
  return { deps, hsp, vault, journal, events, asked, clock, signed, advance: (ms: number) => { nowMs += ms; } };
}

const buy = (amount = 1n * USD, merchant = SELLER, key = 'order-1'): Purchase => ({ key, merchant, item: 'weather dataset, 1 day', amount });
const logs = (ev: FlowEvent[]) => ev.filter((e) => e.type === 'log').map((e) => (e as { text: string }).text).join('\n');

test('happy path: policy ok, one human approval before signing, finalized, receipt', async () => {
  const s = setup();
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.deepEqual(s.asked, ['sign']);
  assert.equal(s.signed.length, 1);
  assert.ok(s.events.some((e) => e.type === 'receipt'));
  assert.equal(s.hsp.callCount('create_order'), 1);
});

test('T6a payment above daily cap is blocked before any HSP call', async () => {
  const s = setup();
  s.vault.spent.set(dayOf(Math.floor(T0 / 1000)), 49n * USD);
  const r = await pay(s.deps, buy(3n * USD));
  assert.equal(r.outcome, 'blocked');
  assert.equal(s.hsp.calls.length, 0);
  const p = s.events.find((e) => e.type === 'policy') as { reason: string; explain: string };
  assert.equal(p.reason, 'OVER_DAILY_CAP');
  assert.match(p.explain, /exceed today's cap/);
});

test('T6b merchant not on the allow list is blocked before any HSP call', async () => {
  const s = setup();
  const r = await pay(s.deps, buy(1n * USD, STRANGER));
  assert.equal(r.outcome, 'blocked');
  assert.equal(s.hsp.calls.length, 0);
  const p = s.events.find((e) => e.type === 'policy') as { reason: string; explain: string };
  assert.equal(p.reason, 'NOT_ALLOWED_MERCHANT');
  assert.match(p.explain, /not on your allowed list/);
});

test('T6c expired quote: re-prepare once, old quote never signed or submitted', async () => {
  const s = setup({ expireFirstQuote: true });
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.equal(s.hsp.callCount('prepare_payment'), 2);
  assert.equal(s.hsp.callCount('finalize_payment'), 1);
  assert.equal(s.hsp.callCount('submit_payment'), 1);
  assert.deepEqual(s.asked, ['sign']);
  assert.equal(s.signed.length, 1);
  assert.match(logs(s.events), /quote expired/);
});

test('T6c quote expires while the human waits: nothing signed, prepare again, human asked again', async () => {
  const s = setup();
  let asks = 0;
  s.deps.human = { decide: async () => { if (++asks === 1) s.advance(6 * 60 * 1000); return true; } };
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.equal(asks, 2);
  assert.equal(s.hsp.callCount('prepare_payment'), 2);
  assert.equal(s.signed.length, 1); // the expired quote was never signed
  assert.equal(s.hsp.callCount('finalize_payment'), 1);
  assert.equal(s.hsp.callCount('submit_payment'), 1);
});

test('T6d Gateway 30043: query_payment first, wait out the old authorization, then a new signature; old one never resubmitted', async () => {
  const s = setup({ gateway30043Once: true });
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.equal(s.hsp.callCount('prepare_payment'), 2);
  assert.equal(s.hsp.callCount('create_order'), 1);
  const seq = s.hsp.calls.map((c) => c.tool);
  const firstSubmit = seq.indexOf('submit_payment');
  const secondPrepare = seq.indexOf('prepare_payment', seq.indexOf('prepare_payment') + 1);
  assert.ok(seq.slice(firstSubmit, secondPrepare).includes('query_payment'), `query_payment must come between the 30043 and the re-prepare: ${seq.join(',')}`);
  assert.equal(s.signed.length, 2);
  assert.ok(s.signed[1].at > s.signed[0].validBefore * 1000, 'new authorization signed only after the earlier one expired');
  const submits = s.hsp.calls.filter((c) => c.tool === 'submit_payment').map((c) => (c.args as { payment_mandate_json: { signature: string } }).payment_mandate_json.signature);
  assert.equal(submits.length, 2);
  assert.notEqual(submits[0], submits[1]);
  assert.deepEqual(s.asked, ['sign', 'sign']); // the human approves the new signature too
  assert.match(logs(s.events), /30043/);
});

test('T6d 30043 but the gateway did accept the first mandate: follow it, never sign again', async () => {
  const s = setup();
  const orig = s.hsp.submit_payment.bind(s.hsp);
  s.hsp.submit_payment = async (a) => { await orig(a); throw new HspError('30043', 'late duplicate response'); };
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.equal(s.signed.length, 1);
  assert.equal(s.hsp.callCount('prepare_payment'), 1);
  assert.equal(s.hsp.callCount('submit_payment'), 1);
});

test('T6d error code comes from a structured field, never from prose', () => {
  assert.equal(errorCodeOf({ code: 30043, message: 'x' }), '30043');
  assert.equal(errorCodeOf(undefined, { error: { code: '30043' } }), '30043');
  assert.equal(errorCodeOf({ error_code: '30043' }), '30043');
  assert.equal(errorCodeOf('Gateway error 30043: prepare again'), 'unknown');
  assert.equal(errorCodeOf({ message: 'see error 30043' }), 'unknown');
});

test('T6e stuck at payment-safe 11 minutes: pending, ids printed, no re-order', async () => {
  const s = setup({ stuckAtSafe: true });
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'pending');
  assert.equal(s.hsp.callCount('create_order'), 1);
  assert.equal(s.hsp.callCount('submit_payment'), 1);
  assert.ok(s.clock.now() - T0 >= PENDING_AFTER_MS);
  const l = logs(s.events);
  assert.match(l, /Pending confirmation\. flow_id=mock-flow-1 payment_request_id=mock-pr-1/);
  assert.ok(!s.events.some((e) => e.type === 'receipt'));
  assert.ok(s.events.some((e) => e.type === 'status' && e.label === 'confirming'));
  assert.equal(s.journal.get('order-1')?.stage, 'pending');
  // a later session resumes with the same ids: still no new order
  s.hsp.scenario.stuckAtSafe = false;
  const r2 = await resume(s.deps, s.journal.get('order-1')!);
  assert.equal(r2.outcome, 'settled');
  assert.equal(s.hsp.callCount('create_order'), 1);
});

test('T6f restart while the approval card is open: nothing signed, same flow_id prepared again, human asked again, no duplicate order', async () => {
  const s = setup({}, ['crash']);
  await assert.rejects(pay(s.deps, buy()), /process killed/);
  const entry = s.journal.get('order-1')!;
  assert.equal(entry.stage, 'prepared');
  assert.equal(s.signed.length, 0);
  const s2events: FlowEvent[] = [];
  s.deps.human = { decide: async () => true };
  const r = await resume({ ...s.deps, emit: (e) => s2events.push(e) }, entry);
  assert.equal(r.outcome, 'settled');
  assert.match(logs(s2events), /nothing was signed; preparing on the same flow_id/);
  assert.equal(s.hsp.callCount('create_order'), 1);
  assert.equal(s.signed.length, 1);
  assert.equal(s.hsp.callCount('submit_payment'), 1);
});

test('T6f restart after signing, before finalize: query_payment, wait out validBefore, then re-sign; no duplicate order', async () => {
  const s = setup();
  const w = s.deps.wallet;
  let crashed = false;
  s.deps.wallet = { address: w.address, signTypedData: async (d) => { const sig = await w.signTypedData(d); if (!crashed) { crashed = true; throw new Error('process killed'); } return sig; } };
  await assert.rejects(pay(s.deps, buy()), /process killed/);
  const entry = s.journal.get('order-1')!;
  assert.equal(entry.stage, 'signed');
  assert.ok(entry.authValidBefore);
  s.deps.wallet = w;
  const oldValidBefore = Number(entry.authValidBefore);
  const before = s.hsp.callCount('query_payment');
  const r = await resume(s.deps, entry);
  assert.equal(r.outcome, 'settled');
  assert.ok(s.hsp.callCount('query_payment') > before);
  assert.equal(s.signed.length, 2);
  assert.ok(s.signed[1].at > oldValidBefore * 1000);
  assert.equal(s.hsp.callCount('create_order'), 1);
  assert.equal(s.hsp.callCount('submit_payment'), 1);
});

test('T6f conflict: gateway payment_request_id differs from the journal -> human decides, nothing signed', async () => {
  const s = setup({}, ['crash']);
  await assert.rejects(pay(s.deps, buy()));
  const entry = { ...s.journal.get('order-1')!, paymentRequestId: 'someone-else' };
  const orig = s.hsp.query_payment.bind(s.hsp);
  s.hsp.query_payment = async (a) => ({ ...(await orig({ ...a, payment_request_id: undefined })), payment_request_id: 'mock-pr-1' });
  const r = await resume(s.deps, entry);
  assert.equal(r.outcome, 'handoff');
  assert.equal(s.signed.length, 0);
  assert.equal(s.hsp.callCount('create_order'), 1);
});

test('T6f restart after submit: resumes polling the same ids, no second submit', async () => {
  const s = setup({}, [true, 'crash']);
  // crash right after submit: wrap submit to throw after the gateway accepted it
  const orig = s.hsp.submit_payment.bind(s.hsp);
  s.hsp.submit_payment = async (a) => { await orig(a); throw new Error('process killed'); };
  s.deps.human = { decide: async () => true };
  const r1 = await pay(s.deps, buy());
  // uncertain submit -> flow queries the existing payment instead of resubmitting
  assert.equal(r1.outcome, 'settled');
  assert.equal(s.hsp.callCount('submit_payment'), 1);
  assert.equal(s.hsp.callCount('create_order'), 1);
});

test('T6f restart with only an order: prepares on the same flow_id, never a new order', async () => {
  const s = setup({}, ['crash']);
  await assert.rejects(pay(s.deps, buy()));
  const entry = { ...s.journal.get('order-1')!, stage: 'ordered' as const };
  s.deps.human = { decide: async () => true };
  const r = await resume(s.deps, entry);
  assert.equal(r.outcome, 'settled');
  assert.equal(s.hsp.callCount('create_order'), 1);
});

test('T7 refused signature: no signature, no finalize_payment, "awaiting human signature" logged, no receipt', async () => {
  const s = setup({}, [false]);
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'refused');
  assert.equal(s.signed.length, 0);
  assert.equal(s.hsp.callCount('finalize_payment'), 0);
  assert.equal(s.hsp.callCount('submit_payment'), 0);
  assert.match(logs(s.events), /awaiting human signature/);
  assert.ok(!s.events.some((e) => e.type === 'receipt'));
  assert.equal(s.vault.receipts.size, 0);
  assert.equal(await s.vault.intentStatus('1'), 'Cancelled');
  assert.equal(s.vault.spent.get(dayOf(Math.floor(T0 / 1000))), 0n);
});

test('T8 "finalized" appears only for payment-finalized; payment-safe renders as confirming', async () => {
  const all: FlowEvent[] = [];
  for (const sc of [{}, { stuckAtSafe: true }, { gateway30043Once: true }, { failWith: 'insufficient balance' }] as MockScenario[]) {
    const s = setup(sc);
    await pay(s.deps, buy());
    all.push(...s.events);
  }
  let finalizedSeen = false;
  for (const e of all) {
    const txt = JSON.stringify(e);
    if (e.type === 'status' && e.status === 'payment-finalized') { finalizedSeen = true; assert.equal(e.label, 'finalized'); continue; }
    assert.doesNotMatch(txt, /finalized/i, `"finalized" leaked in ${txt}`);
    if (e.type === 'status' && e.status === 'payment-safe') assert.ok(['confirming', 'pending confirmation'].includes(e.label), e.label);
  }
  assert.ok(finalizedSeen);
});

test('mandate check: the card is built from the checked EIP-712 message; any mismatch refuses before the human or the wallet', async () => {
  const tamper: Array<[string, (t: { domain: Record<string, unknown>; message: Record<string, unknown>; primaryType: string }) => void]> = [
    ['message.to', (t) => { t.message.to = STRANGER; }],
    ['message.value', (t) => { t.message.value = '5000000'; }],
    ['message.from', (t) => { t.message.from = STRANGER; }],
    ['chainId', (t) => { t.domain.chainId = 1; }],
    ['verifyingContract', (t) => { t.domain.verifyingContract = STRANGER; }],
    ['primaryType', (t) => { t.primaryType = 'Permit'; }],
  ];
  for (const [what, f] of tamper) {
    const s = setup();
    const orig = s.hsp.prepare_payment.bind(s.hsp);
    s.hsp.prepare_payment = async (a) => { const p = await orig(a); const t = structuredClone(p.eip712); f(t as never); return { ...p, eip712: t }; };
    const r = await pay(s.deps, buy());
    assert.equal(r.outcome, 'failed', what);
    assert.deepEqual(s.asked, [], `${what}: human must not be asked`);
    assert.equal(s.signed.length, 0, `${what}: nothing signed`);
    assert.equal(s.hsp.callCount('finalize_payment'), 0, what);
    assert.equal(await s.vault.intentStatus('1'), 'Cancelled', what);
    assert.match(logs(s.events), /refusing to sign/, what);
  }
  // happy path: the card equals the signed message
  const s = setup();
  await pay(s.deps, buy());
  const card = s.events.find((e) => e.type === 'approval_needed') as { payTo: string; tokenTotalRaw: string; payer: string };
  const prep = s.hsp.calls.find((c) => c.tool === 'prepare_payment');
  assert.ok(prep);
  assert.equal(card.payTo.toLowerCase(), SELLER);
  assert.equal(card.tokenTotalRaw, '1000000');
  assert.equal(card.payer, s.deps.wallet.address);
});
