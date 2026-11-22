// Off-chain mirror of PolicyVault.check(): same reasons, same order. Lets the agent block BEFORE any HSP call.
export type Reason = 'OK' | 'NO_POLICY' | 'ZERO_AMOUNT' | 'NOT_ALLOWED_MERCHANT' | 'OVER_PER_PAYMENT' | 'OVER_DAILY_CAP' | 'COOLDOWN';

/** Index = Solidity enum PolicyVault.Reason value. */
export const REASONS: readonly Reason[] = ['OK', 'NO_POLICY', 'ZERO_AMOUNT', 'NOT_ALLOWED_MERCHANT', 'OVER_PER_PAYMENT', 'OVER_DAILY_CAP', 'COOLDOWN'];

export interface Policy { dailyCap: bigint; maxPerPayment: bigint; cooldownSec: number; active: boolean; merchants: string[] }
export interface SpendState { spentToday: bigint; lastPaymentAt: number }
export interface PolicyVerdict { reason: Reason; allowed: boolean; remainingToday: bigint; explain: string }

export function dayOf(nowSec: number): number {
  return Math.floor(nowSec / 86400);
}

/** micro-USD -> "12.50 USD" (truncates, never rounds up). */
export function formatUsd(micro: bigint): string {
  const neg = micro < 0n;
  const v = neg ? -micro : micro;
  const whole = v / 1_000_000n;
  const cents = (v % 1_000_000n) / 10_000n;
  return `${neg ? '-' : ''}${whole}.${cents.toString().padStart(2, '0')} USD`;
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

export function checkPolicy(p: Policy | undefined, s: SpendState, merchant: string, amount: bigint, nowSec: number): PolicyVerdict {
  const verdict = (reason: Reason, remainingToday: bigint, explain: string): PolicyVerdict => ({ reason, allowed: reason === 'OK', remainingToday, explain });
  if (!p || !p.active) return verdict('NO_POLICY', 0n, 'Blocked: this agent has no active spending policy.');
  const remaining = p.dailyCap > s.spentToday ? p.dailyCap - s.spentToday : 0n;
  if (amount <= 0n) return verdict('ZERO_AMOUNT', remaining, 'Blocked: the payment amount is zero.');
  const m = merchant.toLowerCase();
  if (!p.merchants.some((x) => x.toLowerCase() === m))
    return verdict('NOT_ALLOWED_MERCHANT', remaining, `Blocked: merchant ${short(merchant)} is not on your allowed list.`);
  if (amount > p.maxPerPayment)
    return verdict('OVER_PER_PAYMENT', remaining, `Blocked: ${formatUsd(amount)} is above your per-payment limit of ${formatUsd(p.maxPerPayment)}.`);
  if (amount > remaining)
    return verdict('OVER_DAILY_CAP', remaining, `Blocked: ${formatUsd(amount)} would exceed today's cap (${formatUsd(remaining)} left of ${formatUsd(p.dailyCap)}).`);
  if (s.lastPaymentAt !== 0 && nowSec < s.lastPaymentAt + p.cooldownSec)
    return verdict('COOLDOWN', remaining, `Blocked: cooldown, next payment allowed in ${s.lastPaymentAt + p.cooldownSec - nowSec} s.`);
  return verdict('OK', remaining, `Allowed: ${formatUsd(remaining - amount)} of ${formatUsd(p.dailyCap)} left today after this payment.`);
}
