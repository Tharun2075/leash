import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPolicy, formatUsd, REASONS, dayOf } from './policy.ts';
import type { Policy } from './policy.ts';

const M = '0x5e11e700000000000000000000000000000000a1';
const USD = 1_000_000n;
const P: Policy = { dailyCap: 50n * USD, maxPerPayment: 5n * USD, cooldownSec: 60, active: true, merchants: [M] };
const fresh = { spentToday: 0n, lastPaymentAt: 0 };

test('REASONS order matches PolicyVault.Reason enum', () => {
  assert.deepEqual(REASONS, ['OK', 'NO_POLICY', 'ZERO_AMOUNT', 'NOT_ALLOWED_MERCHANT', 'OVER_PER_PAYMENT', 'OVER_DAILY_CAP', 'COOLDOWN']);
});
test('each reason', () => {
  assert.equal(checkPolicy(undefined, fresh, M, USD, 1000).reason, 'NO_POLICY');
  assert.equal(checkPolicy({ ...P, active: false }, fresh, M, USD, 1000).reason, 'NO_POLICY');
  assert.equal(checkPolicy(P, fresh, M, 0n, 1000).reason, 'ZERO_AMOUNT');
  assert.equal(checkPolicy(P, fresh, '0xdead', USD, 1000).reason, 'NOT_ALLOWED_MERCHANT');
  assert.equal(checkPolicy(P, fresh, M, 6n * USD, 1000).reason, 'OVER_PER_PAYMENT');
  assert.equal(checkPolicy(P, { spentToday: 48n * USD, lastPaymentAt: 0 }, M, 3n * USD, 1000).reason, 'OVER_DAILY_CAP');
  assert.equal(checkPolicy(P, { spentToday: 0n, lastPaymentAt: 990 }, M, USD, 1000).reason, 'COOLDOWN');
  const ok = checkPolicy(P, fresh, M.toUpperCase().replace('0X', '0x'), USD, 1000);
  assert.equal(ok.reason, 'OK'); assert.equal(ok.allowed, true); assert.match(ok.explain, /49\.00 USD of 50\.00 USD/);
});
test('check order: unknown merchant AND over cap -> NOT_ALLOWED_MERCHANT', () => {
  assert.equal(checkPolicy(P, { spentToday: 50n * USD, lastPaymentAt: 0 }, '0xdead', 9n * USD, 1000).reason, 'NOT_ALLOWED_MERCHANT');
});
test('boundaries', () => {
  assert.equal(checkPolicy(P, { spentToday: 47n * USD, lastPaymentAt: 0 }, M, 3n * USD, 1000).reason, 'OK');
  assert.equal(checkPolicy(P, fresh, M, 5n * USD, 1000).reason, 'OK');
  assert.equal(checkPolicy(P, { spentToday: 0n, lastPaymentAt: 940 }, M, USD, 1000).reason, 'OK');
  assert.equal(checkPolicy(P, { spentToday: 0n, lastPaymentAt: 941 }, M, USD, 1000).reason, 'COOLDOWN');
  assert.equal(checkPolicy(P, { spentToday: 60n * USD, lastPaymentAt: 0 }, M, USD, 1000).remainingToday, 0n);
});
test('formatUsd truncates', () => {
  assert.equal(formatUsd(0n), '0.00 USD');
  assert.equal(formatUsd(12_500_000n), '12.50 USD');
  assert.equal(formatUsd(1_999_999n), '1.99 USD');
  assert.equal(formatUsd(123456789_000000n), '123456789.00 USD');
  assert.equal(dayOf(86399), 0); assert.equal(dayOf(86400), 1);
});
