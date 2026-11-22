// VaultPort: the agent's view of PolicyVault. LocalVault mirrors the Solidity contract for offline runs;
// ChainVault (chain.ts) calls the deployed contract on HSK Chain testnet.
import { keccak256, encodeAbiParameters, toHex } from 'viem';
import type { Policy, PolicyVerdict, Reason } from './policy.ts';
import { checkPolicy, dayOf } from './policy.ts';

export interface Receipt {
  intentId: string;
  flowIdHash: string;
  paymentRequestIdHash: string;
  policyHash: string;
  hspTxHash: string;
  chainTx?: string;
}

export interface VaultPort {
  verdict(merchant: string, amount: bigint): Promise<PolicyVerdict>;
  policySummary(): Promise<{ dailyCap: bigint; maxPerPayment: bigint }>;
  requestPayment(merchant: string, amount: bigint, quoteRef: string): Promise<string>;
  approve(intentId: string): Promise<void>;
  cancel(intentId: string): Promise<void>;
  settle(intentId: string, flowId: string, paymentRequestId: string, hspTxHash: string): Promise<Receipt>;
  intentStatus(intentId: string): Promise<'None' | 'Pending' | 'Approved' | 'Settled' | 'Cancelled'>;
}

export class PolicyBlockedError extends Error {
  reason: Reason;
  constructor(reason: Reason) {
    super(`PolicyBlocked(${reason})`);
    this.name = 'PolicyBlockedError';
    this.reason = reason;
  }
}

export const idHash = (s: string): `0x${string}` => keccak256(toHex(s));

export function policyHashOf(p: Policy): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' }, { type: 'bool' }],
      [p.dailyCap, p.maxPerPayment, BigInt(p.cooldownSec), p.active],
    ),
  );
}

interface LocalIntent {
  merchant: string;
  amount: bigint;
  day: number;
  status: 'Pending' | 'Approved' | 'Settled' | 'Cancelled';
}

/** In-memory mirror of PolicyVault.sol (same check order, reservation and release rules). */
export class LocalVault implements VaultPort {
  policy: Policy;
  spent = new Map<number, bigint>();
  lastPaymentAt = 0;
  intents = new Map<string, LocalIntent>();
  receipts = new Map<string, Receipt>();
  nowSec: () => number;
  private next = 1;

  constructor(policy: Policy, nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
    this.policy = policy;
    this.nowSec = nowSec;
  }

  async verdict(merchant: string, amount: bigint) {
    const now = this.nowSec();
    return checkPolicy(this.policy, { spentToday: this.spent.get(dayOf(now)) ?? 0n, lastPaymentAt: this.lastPaymentAt }, merchant, amount, now);
  }

  async policySummary() {
    return { dailyCap: this.policy.dailyCap, maxPerPayment: this.policy.maxPerPayment };
  }

  async requestPayment(merchant: string, amount: bigint, _quoteRef: string) {
    const v = await this.verdict(merchant, amount);
    if (!v.allowed) throw new PolicyBlockedError(v.reason);
    const now = this.nowSec();
    const day = dayOf(now);
    this.spent.set(day, (this.spent.get(day) ?? 0n) + amount);
    this.lastPaymentAt = now;
    const id = String(this.next++);
    this.intents.set(id, { merchant, amount, day, status: 'Pending' });
    return id;
  }

  async approve(intentId: string) {
    const i = this.intents.get(intentId);
    if (!i || i.status !== 'Pending') throw new Error(`BadStatus(${i?.status ?? 'None'})`);
    i.status = 'Approved';
  }

  async cancel(intentId: string) {
    const i = this.intents.get(intentId);
    if (!i || (i.status !== 'Pending' && i.status !== 'Approved')) throw new Error(`BadStatus(${i?.status ?? 'None'})`);
    i.status = 'Cancelled';
    this.spent.set(i.day, (this.spent.get(i.day) ?? 0n) - i.amount);
  }

  async settle(intentId: string, flowId: string, paymentRequestId: string, hspTxHash: string) {
    const i = this.intents.get(intentId);
    if (!i || i.status !== 'Approved') throw new Error(`BadStatus(${i?.status ?? 'None'})`);
    i.status = 'Settled';
    const r: Receipt = {
      intentId,
      flowIdHash: idHash(flowId),
      paymentRequestIdHash: idHash(paymentRequestId),
      policyHash: policyHashOf(this.policy),
      hspTxHash,
    };
    this.receipts.set(intentId, r);
    return r;
  }

  async intentStatus(intentId: string) {
    return this.intents.get(intentId)?.status ?? 'None';
  }
}
