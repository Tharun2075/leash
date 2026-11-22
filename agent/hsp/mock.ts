// Offline HSP adapter. Responses follow the shapes in the HSP Agentic Payment guide (QA rev 2026-10-30).
// It is a recorded-shape mock, not the real Gateway: every value it returns is synthetic and labelled so.
import { keccak256, toHex, verifyTypedData } from 'viem';
import type {
  ChainConfig,
  CreateOrderArgs,
  CreateOrderResult,
  FinalizeResult,
  HspTools,
  PrepareResult,
  QueryResult,
  SubmitResult,
} from './types.ts';
import { HspError } from './types.ts';

// Circle test USDC on Ethereum Sepolia, as published on the hackathon faucet page.
export const SEPOLIA_TEST_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

export interface MockScenario {
  /** First prepare_payment returns a quote that is already past quote_expires_at. */
  expireFirstQuote?: boolean;
  /** First submit_payment fails with Gateway error 30043. */
  gateway30043Once?: boolean;
  /** Status climbs to payment-safe and stays there. */
  stuckAtSafe?: boolean;
  /** Terminal failure status with reason. */
  failWith?: string;
  /** Attribution flag returned by query_payment. */
  attributionVerified?: boolean;
}

const PROGRESSION = [
  'payment-submitted',
  'payment-verified',
  'payment-processing',
  'payment-included',
  'payment-safe',
  'payment-finalized',
];

interface MockPayment {
  flow_id: string;
  payment_request_id: string;
  merchant_name: string;
  pay_to: string;
  payer?: string;
  prepares: number;
  lastQuote?: { cart_hash: string; expiresMs: number; token_total_raw: string; eip712: PrepareResult['eip712'] };
  submitted: boolean;
  submitCount: number;
  queries: number;
  usedSignatures: Set<string>;
}

export class MockHspAdapter implements HspTools {
  calls: Array<{ tool: string; args: unknown }> = [];
  payments = new Map<string, MockPayment>();
  scenario: MockScenario;
  now: () => number;
  private seq = 0;

  constructor(scenario: MockScenario = {}, now: () => number = () => Date.now()) {
    this.scenario = scenario;
    this.now = now;
  }

  private log(tool: string, args: unknown) {
    this.calls.push({ tool, args });
  }

  callCount(tool: string): number {
    return this.calls.filter((c) => c.tool === tool).length;
  }

  async get_chain_config(): Promise<ChainConfig> {
    this.log('get_chain_config', {});
    return {
      networks: [
        {
          network: 'sepolia',
          chain_id: 11155111,
          tokens: [{ symbol: 'USDC', address: SEPOLIA_TEST_USDC, decimals: 6, payment_protocol: 'eip3009' }],
        },
      ],
    };
  }

  async create_order(args: CreateOrderArgs): Promise<CreateOrderResult> {
    this.log('create_order', args);
    if (!/^0x[0-9a-fA-F]{40}$/.test(args.pay_to)) throw new HspError('40001', 'pay_to must be a 42-character 0x address');
    this.seq += 1;
    const flow_id = `mock-flow-${this.seq}`;
    const payment_request_id = `mock-pr-${this.seq}`;
    this.payments.set(flow_id, {
      flow_id,
      payment_request_id,
      merchant_name: args.merchant_name,
      pay_to: args.pay_to,
      prepares: 0,
      submitted: false,
      submitCount: 0,
      queries: 0,
      usedSignatures: new Set(),
    });
    return { flow_id, payment_request_id, payment_url: `https://mock.invalid/pay/${flow_id}` };
  }

  async get_order(args: { flow_id: string }): Promise<unknown> {
    this.log('get_order', args);
    const p = this.payments.get(args.flow_id);
    if (!p) throw new HspError('40404', 'order not found');
    return { flow_id: p.flow_id, payment_request_id: p.payment_request_id, gas_fee_advanced: true };
  }

  async prepare_payment(args: { flow_id: string; payer: string; protocol: string }): Promise<PrepareResult> {
    this.log('prepare_payment', args);
    const p = this.payments.get(args.flow_id);
    if (!p) throw new HspError('40404', 'order not found');
    if (args.payer.toLowerCase() === p.pay_to.toLowerCase()) throw new HspError('40002', 'payer must not equal pay_to');
    p.payer = args.payer;
    p.prepares += 1;
    const expired = this.scenario.expireFirstQuote && p.prepares === 1;
    const expiresMs = expired ? this.now() - 1000 : this.now() + 5 * 60 * 1000;
    const token_total_raw = '1000000';
    const nonce = keccak256(toHex(`${p.flow_id}:${p.prepares}`));
    const eip712 = {
      domain: { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: SEPOLIA_TEST_USDC },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: args.payer,
        to: p.pay_to,
        value: token_total_raw,
        validAfter: '0',
        validBefore: String(Math.floor(expiresMs / 1000)),
        nonce,
      },
    };
    const cart_hash = keccak256(toHex(`cart:${p.flow_id}:${p.prepares}`)).slice(2);
    p.lastQuote = { cart_hash, expiresMs, token_total_raw, eip712 };
    return {
      eip712,
      cart_hash,
      token_total_raw,
      quote_expires_at: new Date(expiresMs).toISOString(),
      pay_to: p.pay_to,
      payer: args.payer,
      payment_request_id: p.payment_request_id,
      payment_payload: { payload: { signature: '' }, flow_id: p.flow_id },
      payment_mandate_contents: { flow_id: p.flow_id, prepare: p.prepares },
    };
  }

  async finalize_payment(args: {
    signature: string;
    payment_payload: unknown;
    payment_mandate_contents: unknown;
    cart_hash: string;
  }): Promise<FinalizeResult> {
    this.log('finalize_payment', { cart_hash: args.cart_hash });
    const flowId = (args.payment_mandate_contents as { flow_id: string }).flow_id;
    const p = this.payments.get(flowId);
    if (!p || !p.lastQuote) throw new HspError('40404', 'no prepared quote');
    if (args.cart_hash !== p.lastQuote.cart_hash) throw new HspError('30043', 'cart_hash does not match the current quote');
    const q = p.lastQuote;
    const ok = await verifyTypedData({
      address: p.payer as `0x${string}`,
      domain: q.eip712.domain as never,
      types: q.eip712.types as never,
      primaryType: q.eip712.primaryType as never,
      message: q.eip712.message as never,
      signature: args.signature as `0x${string}`,
    });
    if (!ok) throw new HspError('40003', 'signature does not match payer');
    return {
      payment_mandate_json: { flow_id: flowId, cart_hash: q.cart_hash, signature: args.signature, jwt: 'mock.jwt.unsigned' },
    };
  }

  async estimate_fee(args: Record<string, unknown>): Promise<unknown> {
    this.log('estimate_fee', args);
    return { gas_fee_advanced: true, gas_fee: '0' };
  }

  async submit_payment(args: { payment_mandate_json: unknown }): Promise<SubmitResult> {
    this.log('submit_payment', args);
    const m = args.payment_mandate_json as { flow_id: string; cart_hash: string; signature: string };
    const p = this.payments.get(m.flow_id);
    if (!p || !p.lastQuote) throw new HspError('40404', 'unknown mandate');
    if (p.usedSignatures.has(m.signature)) throw new HspError('30043', 'signature already used');
    if (m.cart_hash !== p.lastQuote.cart_hash || this.now() > p.lastQuote.expiresMs) throw new HspError('30043', 'quote expired');
    p.submitCount += 1;
    p.usedSignatures.add(m.signature);
    if (this.scenario.gateway30043Once && p.submitCount === 1) throw new HspError('30043', 'quote no longer valid, prepare again');
    p.submitted = true;
    return { status: 'payment-submitted' };
  }

  async query_payment(args: { flow_id?: string; payment_request_id?: string; expected_merchant_name: string }): Promise<QueryResult> {
    this.log('query_payment', args);
    const p = [...this.payments.values()].find(
      (x) => x.flow_id === args.flow_id || x.payment_request_id === args.payment_request_id,
    );
    if (!p) throw new HspError('40404', 'payment not found');
    const attribution = (this.scenario.attributionVerified ?? true) && args.expected_merchant_name === p.merchant_name;
    const base = { flow_id: p.flow_id, payment_request_id: p.payment_request_id, attribution_verified: attribution };
    if (!p.submitted) return { ...base, status: 'order-created', payment: {} };
    p.queries += 1;
    if (this.scenario.failWith && p.queries >= 2)
      return { ...base, status: 'payment-failed', payment: { status_reason: this.scenario.failWith } };
    let idx = Math.min(p.queries - 1, PROGRESSION.length - 1);
    if (this.scenario.stuckAtSafe) idx = Math.min(idx, PROGRESSION.indexOf('payment-safe'));
    const status = PROGRESSION[idx];
    const broadcast = idx >= PROGRESSION.indexOf('payment-included');
    return {
      ...base,
      status,
      payment: {
        network: 'sepolia',
        tx_signature: broadcast ? keccak256(toHex(`mock-tx:${p.flow_id}`)) : '',
        to_pay_address: p.pay_to,
        payer_address: p.payer,
      },
    };
  }
}
