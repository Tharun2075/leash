// What-you-approve-is-what-you-sign: check the EIP-712 data from prepare_payment against the purchase
// BEFORE the human sees the card. The card is built from the checked message, never from loose prep fields.
import type { PrepareResult, TokenConfig } from './hsp/types.ts';

export interface MandateExpect {
  token: TokenConfig;
  chainId: number;
  merchant: string; // policy-checked merchant
  payer: string; // our wallet
  amount: bigint; // policy-checked amount, micro-USD (6 decimals)
}

export interface CheckedMandate {
  primaryType: string;
  from: string;
  to: string;
  valueRaw: string;
  validBefore: number; // unix seconds; after this the authorization can never execute
  nonce: string;
}

export class MandateMismatchError extends Error {
  constructor(msg: string) { super(msg); this.name = 'MandateMismatchError'; }
}

const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** Policy amounts are micro-USD; stablecoin raw units use token.decimals. */
export function expectedRaw(amount: bigint, decimals: number): bigint {
  if (decimals < 6) throw new MandateMismatchError(`token decimals ${decimals} < 6 not supported`);
  return amount * 10n ** BigInt(decimals - 6);
}

export function checkMandate(prep: PrepareResult, x: MandateExpect): CheckedMandate {
  const fail = (m: string): never => { throw new MandateMismatchError(m); };
  const t = prep.eip712;
  if (!t || typeof t !== 'object' || !t.domain || !t.message) fail('prepare_payment returned no EIP-712 data');
  if (x.token.payment_protocol !== 'eip3009') {
    // Permit2 puts the recipient in a witness whose layout the guide does not pin down; fail closed.
    fail(`protocol ${x.token.payment_protocol} is not verified by Leash yet; pay by hand`);
  }
  if (t.primaryType !== 'TransferWithAuthorization') fail(`primaryType ${t.primaryType}, expected TransferWithAuthorization`);
  const fields = (t.types?.TransferWithAuthorization ?? []).map((f) => f.name).join(',');
  if (fields !== 'from,to,value,validAfter,validBefore,nonce') fail(`unexpected TransferWithAuthorization fields: ${fields}`);
  if (!same(t.domain.verifyingContract, x.token.address)) fail(`verifyingContract ${String(t.domain.verifyingContract)} is not the chosen token ${x.token.address}`);
  if (Number(t.domain.chainId) !== x.chainId) fail(`domain chainId ${String(t.domain.chainId)} is not the chosen network ${x.chainId}`);
  const m = t.message;
  if (!same(m.to, x.merchant)) fail(`message.to ${String(m.to)} is not the approved merchant ${x.merchant}`);
  if (!same(m.to, prep.pay_to)) fail(`message.to ${String(m.to)} differs from pay_to ${prep.pay_to}`);
  if (!same(m.from, x.payer)) fail(`message.from ${String(m.from)} is not our wallet ${x.payer}`);
  let value: bigint;
  try { value = BigInt(String(m.value)); } catch { return fail(`message.value ${String(m.value)} is not an integer`); }
  if (value !== BigInt(prep.token_total_raw)) fail(`message.value ${value} differs from token_total_raw ${prep.token_total_raw}`);
  const want = expectedRaw(x.amount, x.token.decimals);
  if (value !== want) fail(`message.value ${value} differs from the policy-checked amount ${want}`);
  const validBefore = Number(m.validBefore);
  if (!Number.isFinite(validBefore) || validBefore <= 0) fail('message.validBefore missing');
  if (typeof m.nonce !== 'string') fail('message.nonce missing');
  return { primaryType: t.primaryType, from: String(m.from), to: String(m.to), valueRaw: value.toString(), validBefore, nonce: m.nonce as string };
}
