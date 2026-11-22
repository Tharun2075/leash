// Leash payment flow: policy first, one human approval before signing, HSP state machine exactly as the HSP guide (rev 2026-10-30).
// Rules encoded here (each has a test in flow.test.ts):
//  - policy blocks happen BEFORE any HSP call (T6 a, b)
//  - expired quote or Gateway 30043 -> prepare again once, new signature, never resubmit the old one (T6 c, d)
//  - 10 minutes without payment-finalized -> "Pending confirmation", print ids, never re-order (T6 e)
//  - restart compares the journal with query_payment before doing anything; conflicts go to the human (T6 f)
//  - ONE human approval before signing covers sign+finalize+submit; refused -> no signature, no finalize_payment (T7)
//  - the card is built from the checked EIP-712 message (agent/mandate.ts); any mismatch -> refuse to sign
//  - 30043 -> query_payment + wait out the earlier authorization's validBefore before any new signature (T6 d)
//  - "finalized" only for payment-finalized; payment-safe is "confirming" (T8)
import type { Eip712Data, HspTools, PrepareResult, TokenConfig } from './hsp/types.ts';
import { HspError, POLLING_STATUSES, statusLabel } from './hsp/types.ts';
import type { Journal, JournalEntry, Stage } from './journal.ts';
import type { Receipt, VaultPort } from './vault.ts';
import { PolicyBlockedError, idHash } from './vault.ts';
import { formatUsd } from './policy.ts';
import { checkMandate } from './mandate.ts';
import type { CheckedMandate } from './mandate.ts';

export const POLL_MS = 15_000;
export const PENDING_AFTER_MS = 10 * 60 * 1000;
export const MAX_PREPARES = 2; // first quote + one re-prepare

export type Outcome = 'settled' | 'blocked' | 'refused' | 'pending' | 'failed' | 'handoff';

export type FlowEvent =
  | { type: 'chat'; from: 'buyer' | 'seller' | 'human'; text: string }
  | { type: 'policy'; allowed: boolean; reason: string; explain: string; remainingToday: string; dailyCap: string; maxPerPayment: string; merchant: string }
  | { type: 'approval_needed'; step: 'sign' | 'submit'; payTo: string; payer: string; tokenTotalRaw: string; quoteExpiresAt: string }
  | { type: 'status'; status: string; label: string }
  | { type: 'hsp_mode'; mode: 'live' | 'mock'; label: string }
  | { type: 'receipt'; intentId: string; flowId: string; paymentRequestId: string; policyHash: string; txHash: string; explorerUrl: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string }
  | { type: 'done'; outcome: Outcome };

export interface ApprovalInfo { payTo: string; payer: string; tokenTotalRaw: string; quoteExpiresAt: string }
export interface HumanGate { decide(step: 'sign' | 'submit', info: ApprovalInfo): Promise<boolean> }
export interface WalletSigner { address: string; signTypedData(d: Eip712Data): Promise<string> }
export interface Clock { now(): number; sleep(ms: number): Promise<void> }

export interface FlowDeps {
  hsp: HspTools;
  vault: VaultPort;
  journal: Journal;
  human: HumanGate;
  wallet: WalletSigner;
  clock: Clock;
  emit: (e: FlowEvent) => void;
  merchantName: string;
  explorerUrl?: (txHash: string) => string;
}

export interface Purchase { key: string; merchant: string; item: string; amount: bigint }
export interface FlowResult { outcome: Outcome; receipt?: Receipt; flowId?: string; paymentRequestId?: string }

export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

function info(d: FlowDeps, text: string) { d.emit({ type: 'log', level: 'info', text }); }
function warn(d: FlowDeps, text: string) { d.emit({ type: 'log', level: 'warn', text }); }

function save(d: FlowDeps, e: JournalEntry, stage: Stage, extra: Partial<JournalEntry> = {}) {
  Object.assign(e, extra, { stage, updatedAt: new Date(d.clock.now()).toISOString() });
  d.journal.put(e);
}

function finish(d: FlowDeps, outcome: Outcome, rest: Omit<FlowResult, 'outcome'> = {}): FlowResult {
  d.emit({ type: 'done', outcome });
  return { outcome, ...rest };
}

function idsLine(e: JournalEntry) { return `flow_id=${e.flowId} payment_request_id=${e.paymentRequestId}`; }

function quoteExpired(d: FlowDeps, p: PrepareResult) { return d.clock.now() >= Date.parse(p.quote_expires_at); }

function cartMandate(p: Purchase, net: { network: string; chain_id: number }, token: TokenConfig, nowMs: number) {
  const usd = formatUsd(p.amount).replace(' USD', '');
  return {
    contents: {
      id: p.key,
      cart_expiry: new Date(nowMs + 15 * 60 * 1000).toISOString(),
      payment_request: {
        method_data: [
          {
            supported_methods: 'https://www.x402.org/',
            data: { x402Version: 2, network: net.network, chain_id: net.chain_id, contract_address: token.address, coin: token.symbol },
          },
        ],
        details: {
          id: p.key,
          display_items: [{ label: p.item, amount: { currency: 'USD', value: usd } }],
          total: { label: 'Total', amount: { currency: 'USD', value: usd } },
        },
      },
    },
  };
}

/** Pick the one supported network/token. More than one = the human must choose (guide section 5). */
async function pickToken(d: FlowDeps) {
  const cfg = await d.hsp.get_chain_config();
  const combos = cfg.networks.flatMap((n) => n.tokens.map((t) => ({ net: n, token: t })));
  if (combos.length !== 1) return undefined;
  return combos[0];
}

/** Start a new purchase. */
export async function pay(d: FlowDeps, p: Purchase): Promise<FlowResult> {
  const v = await d.vault.verdict(p.merchant, p.amount);
  const s = await d.vault.policySummary();
  d.emit({
    type: 'policy', allowed: v.allowed, reason: v.reason, explain: v.explain,
    remainingToday: formatUsd(v.remainingToday), dailyCap: formatUsd(s.dailyCap), maxPerPayment: formatUsd(s.maxPerPayment), merchant: p.merchant,
  });
  if (!v.allowed) {
    info(d, `policy blocked (${v.reason}) before any HSP call`);
    return finish(d, 'blocked');
  }
  let intentId: string;
  try {
    intentId = await d.vault.requestPayment(p.merchant, p.amount, idHash(p.key));
  } catch (err) {
    if (err instanceof PolicyBlockedError) {
      info(d, `PolicyVault reverted PolicyBlocked(${err.reason}) before any HSP call`);
      return finish(d, 'blocked');
    }
    throw err;
  }
  const e: JournalEntry = { key: p.key, intentId, merchant: p.merchant, amount: String(p.amount), stage: 'intent', updatedAt: '' };
  save(d, e, 'intent');
  info(d, `intent ${intentId} reserved on PolicyVault`);

  const pick = await pickToken(d);
  if (!pick) {
    warn(d, 'get_chain_config returned zero or several network/token options; the human must choose. Not guessing.');
    return finish(d, 'handoff');
  }
  const order = await d.hsp.create_order({
    merchant_name: d.merchantName,
    pay_to: p.merchant,
    cart_mandate: cartMandate(p, pick.net, pick.token, d.clock.now()),
  });
  save(d, e, 'ordered', { flowId: order.flow_id, paymentRequestId: order.payment_request_id });
  info(d, `order created ${idsLine(e)}`);
  return signAndSubmit(d, e, pick);
}

type Pick = { net: { network: string; chain_id: number }; token: TokenConfig };

/** Longest we wait for an earlier authorization to expire before handing to the human. */
export const MAX_RETIRE_WAIT_MS = 10 * 60 * 1000;

function hspCode(err: unknown): string | undefined { return err instanceof HspError ? err.code : undefined; }

/**
 * Before any NEW authorization: the earlier one must be provably dead. Ask query_payment first; if the
 * gateway has the payment, follow it (no new signature). Otherwise wait until the earlier validBefore
 * has passed, then check again. Returns a result when the flow ends here, undefined when re-preparing is safe.
 */
async function retireEarlier(d: FlowDeps, e: JournalEntry): Promise<FlowResult | undefined> {
  const ask = async () => d.hsp.query_payment({ flow_id: e.flowId, payment_request_id: e.paymentRequestId, expected_merchant_name: d.merchantName });
  let q;
  try { q = await ask(); } catch (err) {
    warn(d, `query_payment failed (${(err as Error).message}); cannot prove the earlier authorization is unused. Human needed; budget stays reserved. ${idsLine(e)}`);
    return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
  }
  if (KNOWN.has(q.status)) {
    info(d, `gateway accepted the earlier mandate (${q.status}); following it, no new signature`);
    save(d, e, 'submitted');
    return poll(d, e);
  }
  const vb = Number(e.authValidBefore ?? 0) * 1000;
  const waitMs = vb - d.clock.now() + 1000;
  if (waitMs > MAX_RETIRE_WAIT_MS) {
    warn(d, `earlier authorization stays valid until ${new Date(vb).toISOString()}; not signing another before then. Human needed; budget stays reserved. ${idsLine(e)}`);
    return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
  }
  if (waitMs > 0) {
    info(d, `gateway shows "${q.status}" (earlier mandate not accepted); waiting until its authorization expires at ${new Date(vb).toISOString()} before signing a new one`);
    await d.clock.sleep(waitMs);
    try { q = await ask(); } catch { return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId }); }
    if (KNOWN.has(q.status)) { info(d, `earlier mandate landed after all (${q.status}); following it`); save(d, e, 'submitted'); return poll(d, e); }
  }
  info(d, 'earlier authorization expired unused; preparing a fresh quote');
  save(d, e, 'ordered', { authValidBefore: undefined });
  return undefined;
}

async function signAndSubmit(d: FlowDeps, e: JournalEntry, pick: Pick): Promise<FlowResult> {
  const amount = BigInt(e.amount);
  for (let attempt = 1; attempt <= MAX_PREPARES; attempt++) {
    const prep = await d.hsp.prepare_payment({ flow_id: e.flowId as string, payer: d.wallet.address, protocol: pick.token.payment_protocol });
    save(d, e, 'prepared', { cartHash: prep.cart_hash });
    if (quoteExpired(d, prep)) {
      warn(d, `quote expired at ${prep.quote_expires_at}; preparing again (old quote is never signed)`);
      continue;
    }
    let m: CheckedMandate;
    try {
      m = checkMandate(prep, { token: pick.token, chainId: pick.net.chain_id, merchant: e.merchant, payer: d.wallet.address, amount });
    } catch (err) {
      warn(d, `refusing to sign: ${(err as Error).message}. Nothing signed. ${idsLine(e)}`);
      await d.vault.cancel(e.intentId);
      save(d, e, 'closed');
      return finish(d, 'failed', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
    }
    // The card shows the checked EIP-712 message: what the human approves is what the wallet signs.
    const ask: ApprovalInfo = { payTo: m.to, payer: m.from, tokenTotalRaw: m.valueRaw, quoteExpiresAt: prep.quote_expires_at };
    d.emit({ type: 'approval_needed', step: 'sign', ...ask });
    info(d, 'awaiting human signature (one approval covers signing, finalize_payment and submit_payment)');
    if (!(await d.human.decide('sign', ask))) {
      info(d, 'human refused: nothing signed, no finalize_payment, no payment, no receipt');
      await d.vault.cancel(e.intentId);
      save(d, e, 'closed');
      return finish(d, 'refused');
    }
    d.emit({ type: 'chat', from: 'human', text: 'Approved: sign and submit this payment.' });
    if ((await d.vault.intentStatus(e.intentId)) === 'Pending') await d.vault.approve(e.intentId);
    if (quoteExpired(d, prep)) {
      warn(d, 'quote expired while waiting for the human; nothing was signed; preparing again');
      continue;
    }
    // Journal BEFORE signing: from here on a live authorization may exist until validBefore.
    save(d, e, 'signed', { authValidBefore: String(m.validBefore) });
    const signature = await d.wallet.signTypedData(prep.eip712);
    let stage = 'finalize_payment';
    try {
      const fin = await d.hsp.finalize_payment({
        signature, payment_payload: prep.payment_payload, payment_mandate_contents: prep.payment_mandate_contents, cart_hash: prep.cart_hash,
      });
      stage = 'submit_payment';
      const sub = await d.hsp.submit_payment({ payment_mandate_json: fin.payment_mandate_json });
      save(d, e, 'submitted');
      d.emit({ type: 'status', status: sub.status, label: statusLabel(sub.status) });
      return poll(d, e);
    } catch (err) {
      if (hspCode(err) === '30043') {
        warn(d, `Gateway returned 30043 on ${stage}; checking the earlier mandate before any new signature (old signature is never resubmitted)`);
        const r = await retireEarlier(d, e);
        if (r) return r;
        continue;
      }
      warn(d, `${stage} uncertain (${(err as Error).message}); querying the existing payment before any action`);
      return resume(d, e);
    }
  }
  warn(d, `quote failed ${MAX_PREPARES} times; handing to the human. ${idsLine(e)}`);
  return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
}

/** Poll every 15 s with the same ids until payment-finalized, payment-failed, or the 10-minute pending rule. */
async function poll(d: FlowDeps, e: JournalEntry): Promise<FlowResult> {
  const start = d.clock.now();
  let last = '';
  let safeReported = false;
  for (;;) {
    let q;
    try {
      q = await d.hsp.query_payment({ flow_id: e.flowId, payment_request_id: e.paymentRequestId, expected_merchant_name: d.merchantName });
    } catch (err) {
      warn(d, `query_payment error: ${(err as Error).message}. Keeping ${idsLine(e)}`);
      q = undefined;
    }
    if (q) {
      if (q.status !== last) {
        d.emit({ type: 'status', status: q.status, label: statusLabel(q.status) });
        last = q.status;
      }
      if (q.status === 'payment-finalized') {
        if (!q.attribution_verified) warn(d, `attribution_verified=false for team "${d.merchantName}"`);
        info(d, 'The payment has reached final confirmation.');
        const txHash = q.payment.tx_signature || '';
        const r = await d.vault.settle(e.intentId, e.flowId as string, e.paymentRequestId as string, txHash ? txHash : idHash('unavailable'));
        save(d, e, 'settled');
        d.emit({
          type: 'receipt', intentId: e.intentId, flowId: e.flowId as string, paymentRequestId: e.paymentRequestId as string,
          policyHash: r.policyHash, txHash: txHash || 'unavailable', explorerUrl: r.chainTx && d.explorerUrl ? d.explorerUrl(r.chainTx) : '',
        });
        return finish(d, 'settled', { receipt: r, flowId: e.flowId, paymentRequestId: e.paymentRequestId });
      }
      if (q.status === 'payment-failed') {
        warn(d, `payment failed: ${q.payment.status_reason ?? 'no reason returned'}`);
        await d.vault.cancel(e.intentId);
        save(d, e, 'closed');
        return finish(d, 'failed', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
      }
      if (q.status === 'payment-safe') {
        if (!safeReported) info(d, 'The transaction is on-chain and has received half of the required block confirmations. It is not yet final.');
        safeReported = true;
      } else if (!POLLING_STATUSES.has(q.status)) {
        warn(d, `unrecognized status "${q.status}"; not guessing. Human needed. ${idsLine(e)}`);
        save(d, e, 'pending');
        return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
      }
    }
    if (d.clock.now() - start >= PENDING_AFTER_MS) {
      d.emit({ type: 'status', status: last || 'unknown', label: 'pending confirmation' });
      warn(d, `Pending confirmation. ${idsLine(e)}. No replacement order; resume with these ids.`);
      save(d, e, 'pending');
      return finish(d, 'pending', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
    }
    await d.clock.sleep(POLL_MS);
  }
}

const KNOWN = new Set([...POLLING_STATUSES, 'payment-safe', 'payment-finalized', 'payment-failed']);

/** Restart path: compare-and-set the journal against query_payment. Never creates a second order or mandate. */
export async function resume(d: FlowDeps, e: JournalEntry): Promise<FlowResult> {
  info(d, `resuming ${e.key} from stage "${e.stage}"`);
  if (!e.flowId) {
    warn(d, `intent ${e.intentId} has no HSP order on record; human decides whether to cancel it. No order created.`);
    return finish(d, 'handoff');
  }
  let q;
  try {
    q = await d.hsp.query_payment({ flow_id: e.flowId, payment_request_id: e.paymentRequestId, expected_merchant_name: d.merchantName });
  } catch (err) {
    warn(d, `query_payment failed on resume: ${(err as Error).message}. Human needed. ${idsLine(e)}`);
    return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
  }
  if (q.payment_request_id && q.payment_request_id !== e.paymentRequestId) {
    warn(d, `conflict: journal payment_request_id=${e.paymentRequestId} but gateway says ${q.payment_request_id}. Human decides.`);
    return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
  }
  const submittedRemote = KNOWN.has(q.status);
  if (submittedRemote) {
    info(d, `gateway has the payment (${q.status}); continuing to poll the same ids`);
    save(d, e, 'submitted');
    return poll(d, e);
  }
  if (e.stage === 'ordered' || e.stage === 'intent' || e.stage === 'prepared') {
    // 'prepared' is journaled before the approval card; 'signed' is journaled BEFORE signing, so nothing was signed here.
    info(d, `gateway shows "${q.status}" and nothing was signed; preparing on the same flow_id (no new order), human approves again`);
    const pick = await pickToken(d);
    if (!pick) return finish(d, 'handoff');
    return signAndSubmit(d, e, pick);
  }
  if (e.stage === 'signed') {
    info(d, `an authorization may exist (journal stage "signed"); proving it unused before any new signature`);
    const r = await retireEarlier(d, e);
    if (r) return r;
    const pick = await pickToken(d);
    if (!pick) return finish(d, 'handoff');
    return signAndSubmit(d, e, pick);
  }
  warn(d, `conflict: journal stage "${e.stage}" but gateway shows "${q.status}" (no payment). Human decides. ${idsLine(e)}`);
  return finish(d, 'handoff', { flowId: e.flowId, paymentRequestId: e.paymentRequestId });
}
