// HSP Agentic Payment tool surface, as documented in the HSP guide (QA revision 2026-10-30).
// Parameter names follow the guide; the live adapter re-reads the live input schemas on connect.

export const REQUIRED_TOOLS = [
  'get_chain_config',
  'create_order',
  'get_order',
  'prepare_payment',
  'finalize_payment',
  'estimate_fee',
  'submit_payment',
  'query_payment',
] as const;

export type ToolName = (typeof REQUIRED_TOOLS)[number];

export interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
  payment_protocol: 'eip3009' | 'permit2';
}

export interface NetworkConfig {
  network: string;
  chain_id: number;
  tokens: TokenConfig[];
}

export interface ChainConfig {
  networks: NetworkConfig[];
}

export interface CreateOrderArgs {
  merchant_name: string;
  pay_to: string;
  cart_mandate: unknown;
}

export interface CreateOrderResult {
  flow_id: string;
  payment_request_id: string;
  payment_url: string;
}

export interface Eip712Data {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface PrepareResult {
  eip712: Eip712Data;
  cart_hash: string;
  token_total_raw: string;
  quote_expires_at: string;
  pay_to: string;
  payer: string;
  payment_request_id: string;
  payment_payload: unknown;
  payment_mandate_contents: unknown;
}

export interface FinalizeResult {
  payment_mandate_json: unknown;
}

export interface SubmitResult {
  status: string;
}

export interface QueryResult {
  status: string;
  attribution_verified: boolean;
  payment: {
    network?: string;
    tx_signature?: string;
    to_pay_address?: string;
    payer_address?: string;
    status_reason?: string;
  };
  flow_id?: string;
  payment_request_id?: string;
}

/** The eight HSP MCP tools. Implemented by McpHspAdapter (live, pending allowlist) and MockHspAdapter (offline). */
export interface HspTools {
  get_chain_config(): Promise<ChainConfig>;
  create_order(args: CreateOrderArgs): Promise<CreateOrderResult>;
  get_order(args: { flow_id: string }): Promise<unknown>;
  prepare_payment(args: { flow_id: string; payer: string; protocol: string }): Promise<PrepareResult>;
  finalize_payment(args: {
    signature: string;
    payment_payload: unknown;
    payment_mandate_contents: unknown;
    cart_hash: string;
  }): Promise<FinalizeResult>;
  estimate_fee(args: Record<string, unknown>): Promise<unknown>;
  submit_payment(args: { payment_mandate_json: unknown }): Promise<SubmitResult>;
  query_payment(args: { flow_id?: string; payment_request_id?: string; expected_merchant_name: string }): Promise<QueryResult>;
}

/** Gateway error with the HSP code (e.g. '30043' = quote/signature rejected, re-prepare). */
export class HspError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HspError';
    this.code = code;
  }
}

/** Read a Gateway error code from a structured field only (code / error_code / error.code). Never parsed out of prose. */
export function errorCodeOf(...sources: unknown[]): string {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    const o = src as Record<string, unknown>;
    const inner = o.error && typeof o.error === 'object' ? (o.error as Record<string, unknown>) : undefined;
    for (const c of [o.code, o.error_code, inner?.code, inner?.error_code]) {
      if (typeof c === 'number' || (typeof c === 'string' && c !== '')) return String(c);
    }
  }
  return 'unknown';
}

/** Statuses during which the guide says: keep querying the same payment. */
export const POLLING_STATUSES = new Set([
  'payment-submitted',
  'payment-verified',
  'payment-processing',
  'payment-included',
  'payment-timeout',
]);

/** UI/log wording. "finalized" is reserved for payment-finalized only (T8). */
export function statusLabel(status: string): string {
  if (status === 'payment-safe') return 'confirming';
  if (status === 'payment-finalized') return 'finalized';
  return status;
}
