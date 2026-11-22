// Off-chain receipt: PolicyVault.settle() already stores keccak(flow_id) and keccak(payment_request_id)
// next to policyHash on chain. This file keeps the plain ids (which the chain only holds as hashes),
// the HSP status history and the mode, signed by the agent key (EIP-191) and linked by the settle tx hash.
// Anyone can check it: hash the ids, compare with getReceipt(intentId), and recover the signer.
import { keccak256, recoverMessageAddress, toHex } from 'viem';
import type { Address, Hex, LocalAccount } from 'viem';
import type { HspMode } from './hsp/mode.ts';
import { modeLabel } from './hsp/mode.ts';

export interface ReceiptBody {
  version: 1;
  hsp_mode: HspMode;
  hsp_label: string;
  chain_id: number;
  vault: Address;
  intent_id: string;
  settle_tx: Hex;
  flow_id: string;
  payment_request_id: string;
  flow_id_hash: Hex;
  payment_request_id_hash: Hex;
  policy_hash: Hex;
  hsp_tx_hash: Hex;
  hsp_status_history: { status: string; label: string }[];
  agent: Address;
  issued_at: string;
}

export interface SignedReceipt extends ReceiptBody { signature: Hex }

/** Stable text that is signed: keys in a fixed order, no whitespace. */
export const canonical = (b: ReceiptBody) => JSON.stringify(b, Object.keys(b).sort());

export function buildBody(x: Omit<ReceiptBody, 'version' | 'hsp_label' | 'flow_id_hash' | 'payment_request_id_hash'>): ReceiptBody {
  return {
    version: 1, hsp_label: modeLabel(x.hsp_mode), ...x,
    flow_id_hash: keccak256(toHex(x.flow_id)), payment_request_id_hash: keccak256(toHex(x.payment_request_id)),
  };
}

export async function signReceipt(agent: LocalAccount, body: ReceiptBody): Promise<SignedReceipt> {
  if (agent.address.toLowerCase() !== body.agent.toLowerCase()) throw new Error('receipt agent does not match the signing key');
  return { ...body, signature: await agent.signMessage({ message: canonical(body) }) };
}

/** Checks signature and that the hashes match the plain ids. Returns the recovered signer. */
export async function verifyReceipt(r: SignedReceipt): Promise<Address> {
  const { signature, ...body } = r;
  if (keccak256(toHex(body.flow_id)) !== body.flow_id_hash) throw new Error('flow_id does not match flow_id_hash');
  if (keccak256(toHex(body.payment_request_id)) !== body.payment_request_id_hash) throw new Error('payment_request_id does not match its hash');
  const signer = await recoverMessageAddress({ message: canonical(body as ReceiptBody), signature });
  if (signer.toLowerCase() !== body.agent.toLowerCase()) throw new Error(`signed by ${signer}, not the agent ${body.agent}`);
  return signer;
}
