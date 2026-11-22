import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildBody, signReceipt, verifyReceipt } from './receipt.ts';
import { hspMode, HSP_MOCK_LABEL } from './hsp/mode.ts';

const agent = privateKeyToAccount(generatePrivateKey());
const body = () => buildBody({
  hsp_mode: 'mock', chain_id: 177, vault: '0x736076b308c720d38bb31bdf97e5726ab90f13a9', intent_id: '2',
  settle_tx: `0x${'ab'.repeat(32)}`, flow_id: 'mock-flow-1', payment_request_id: 'mock-pr-1',
  policy_hash: `0x${'11'.repeat(32)}`, hsp_tx_hash: `0x${'22'.repeat(32)}`,
  hsp_status_history: [{ status: 'payment-safe', label: 'confirming' }, { status: 'payment-finalized', label: 'finalized' }],
  agent: agent.address, issued_at: '2026-11-22T00:00:00Z',
});

test('receipt: signed by the agent, labelled mock, verifies', async () => {
  const r = await signReceipt(agent, body());
  assert.equal(r.hsp_label, HSP_MOCK_LABEL);
  assert.equal(await verifyReceipt(r), agent.address);
});

test('receipt: a changed id or a foreign key fails', async () => {
  const r = await signReceipt(agent, body());
  await assert.rejects(verifyReceipt({ ...r, flow_id: 'mock-flow-2' }), /flow_id/);
  await assert.rejects(verifyReceipt({ ...r, hsp_mode: 'live' }), /signed by/);
  const history = [{ status: 'payment-failed', label: 'failed' }, r.hsp_status_history[1]];
  await assert.rejects(verifyReceipt({ ...r, hsp_status_history: history }), /signed by/);
  await assert.rejects(signReceipt(privateKeyToAccount(generatePrivateKey()), body()), /does not match/);
});

test('HSP_MODE: mock by default, LEASH_HSP alias, bad value refused', () => {
  assert.equal(hspMode({}), 'mock');
  assert.equal(hspMode({ LEASH_HSP: 'live' }), 'live');
  assert.equal(hspMode({ HSP_MODE: 'mock', LEASH_HSP: 'live' }), 'mock');
  assert.throws(() => hspMode({ HSP_MODE: 'prod' }), /live or mock/);
});
