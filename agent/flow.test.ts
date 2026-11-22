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
  const deps: FlowDeps = {
    hsp, vault, journal, clock,
    emit: (e) => events.push(e),
    merchantName: 'Leash demo seller',
    wallet: { address: account.address, signTypedData: (d) => account.signTypedData(d as never) },
    human: {
      decide: async (step) => {
        asked.push(step);
        const a = decisions.shift();
        if (a === 'crash') throw new Error('process killed');
        return a ?? false;
      },
    },
  };
  return { deps, hsp, vault, journal, events, asked, clock, advance: (ms: number) => { nowMs += ms; } };
}

const buy = (amount = 1n * USD, merchant = SELLER, key = 'order-1'): Purchase => ({ key, merchant, item: 'weather dataset, 1 day', amount });
const logs = (ev: FlowEvent[]) => ev.filter((e) => e.type === 'log').map((e) => (e as { text: string }).text).join('\n');

test('happy path: policy ok, two human approvals, finalized, receipt', async () => {
  const s = setup();
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.deepEqual(s.asked, ['sign', 'submit']);
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
  assert.deepEqual(s.asked, ['sign', 'submit']);
  assert.match(logs(s.events), /quote expired/);
});

test('T6c quote expires while the human waits: prepare again, no submit of the old signature', async () => {
  const s = setup();
  let submits = 0;
  s.deps.human = { decide: async (step) => { if (step === 'submit' && ++submits === 1) s.advance(6 * 60 * 1000); return true; } };
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.equal(s.hsp.callCount('prepare_payment'), 2);
  assert.equal(s.hsp.callCount('submit_payment'), 1);
});

test('T6d Gateway 30043: re-prepare once with a new signature, never resubmit the old one', async () => {
  const s = setup({ gateway30043Once: true });
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'settled');
  assert.equal(s.hsp.callCount('prepare_payment'), 2);
  assert.equal(s.hsp.callCount('create_order'), 1);
  const submits = s.hsp.calls.filter((c) => c.tool === 'submit_payment').map((c) => (c.args as { payment_mandate_json: { signature: string } }).payment_mandate_json.signature);
  assert.equal(submits.length, 2);
  assert.notEqual(submits[0], submits[1]);
  assert.match(logs(s.events), /30043/);
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

test('T6f restart between prepare and finalize: compare with query_payment, hand conflict to human, no duplicate mandate', async () => {
  const s = setup({}, ['crash']);
  await assert.rejects(pay(s.deps, buy()), /process killed/);
  const entry = s.journal.get('order-1')!;
  assert.equal(entry.stage, 'prepared');
  // new process: same gateway (mock), same journal
  const s2events: FlowEvent[] = [];
  const r = await resume({ ...s.deps, emit: (e) => s2events.push(e) }, entry);
  assert.equal(r.outcome, 'handoff');
  assert.match(logs(s2events), /conflict: journal stage "prepared"/);
  assert.equal(s.hsp.callCount('create_order'), 1);
  assert.equal(s.hsp.callCount('finalize_payment'), 0);
  assert.equal(s.hsp.callCount('submit_payment'), 0);
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

test('T7 refused signature: no finalize_payment, "awaiting human signature" logged, no receipt', async () => {
  const s = setup({}, [false]);
  const r = await pay(s.deps, buy());
  assert.equal(r.outcome, 'refused');
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
