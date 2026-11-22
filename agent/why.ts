// "Why blocked" decoder: turns a PolicyVault Reason (enum number, name, or the raw PolicyBlocked revert data
// that an explorer shows on a failed tx) into one plain sentence a non-developer can read.
import { decodeErrorResult } from 'viem';
import type { Hex } from 'viem';
import { VAULT_ABI } from './chain.ts';
import { REASONS, formatUsd } from './policy.ts';
import type { Reason } from './policy.ts';

export interface BudgetHint { dailyCap?: bigint; maxPerPayment?: bigint; remainingToday?: bigint; cooldownSec?: number }
export interface Why { code: number | null; reason: Reason | 'UNKNOWN'; blocked: boolean; sentence: string }

const usd = (v: bigint | undefined) => (v === undefined ? undefined : formatUsd(v));

function sentenceFor(reason: Reason, h: BudgetHint): string {
  switch (reason) {
    case 'OK': return 'Not blocked: the payment fits the budget the owner set.';
    case 'NO_POLICY': return 'Blocked because the owner has not given this agent a budget yet, so it cannot spend anything.';
    case 'ZERO_AMOUNT': return 'Blocked because the payment amount was zero.';
    case 'NOT_ALLOWED_MERCHANT': return 'Blocked because this shop is not on the list of shops the owner allowed for this agent.';
    case 'OVER_PER_PAYMENT': return `Blocked because one payment may not be larger than ${usd(h.maxPerPayment) ?? 'the per-payment limit the owner set'}.`;
    case 'OVER_DAILY_CAP': return h.remainingToday !== undefined
      ? `Blocked because it would go over today's budget: only ${usd(h.remainingToday)} of ${usd(h.dailyCap) ?? 'the daily budget'} is left.`
      : "Blocked because it would go over the agent's budget for today.";
    case 'COOLDOWN': return `Blocked because the agent must wait ${h.cooldownSec !== undefined ? `${h.cooldownSec} s` : 'a short pause'} between payments.`;
  }
}

/** Accepts 4, "4", "OVER_PER_PAYMENT", or 0x revert data of PolicyBlocked(uint8). Never throws. */
export function whyBlocked(input: number | string, hint: BudgetHint = {}): Why {
  let code: number | null = null;
  const s = typeof input === 'string' ? input.trim() : input;
  if (typeof s === 'number') code = Number.isInteger(s) ? s : null;
  else if (/^\d{1,3}$/.test(s)) code = Number(s);
  else if (/^0x[0-9a-fA-F]+$/.test(s)) {
    try {
      const d = decodeErrorResult({ abi: VAULT_ABI, data: s as Hex });
      if (d.errorName === 'PolicyBlocked') code = Number(d.args?.[0]);
    } catch { code = null; }
  } else {
    const i = REASONS.indexOf(s.toUpperCase() as Reason);
    if (i >= 0) code = i;
  }
  const reason = code !== null ? REASONS[code] : undefined;
  if (!reason) return { code, reason: 'UNKNOWN', blocked: true, sentence: `Unknown reason${code !== null ? ` code ${code}` : ''}: this is not a Leash budget rule, check the raw error on the explorer.` };
  return { code, reason, blocked: reason !== 'OK', sentence: sentenceFor(reason, hint) };
}
