// Latest mainnet receipt for the budget panel: the agent-signed off-chain JSON (plain flow_id /
// payment_request_id) checked against the hashes PolicyVault.getReceipt holds on chain.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import { VAULT_ABI } from './chain.ts';
import { verifyReceipt } from './receipt.ts';
import type { SignedReceipt } from './receipt.ts';
import { MAINNET_RPC, EXPLORER } from './budget.ts';

const LATEST = fileURLToPath(new URL('../receipts/latest-177.json', import.meta.url));

export interface ReceiptView {
  receipt: SignedReceipt;
  signatureOk: boolean;
  onChain: { flowIdHashMatch: boolean; paymentRequestIdHashMatch: boolean; policyHashMatch: boolean; settledAt: string };
  txUrl: string;
  readAt: string;
}

export async function readReceipt(file = LATEST, rpcUrl = MAINNET_RPC): Promise<ReceiptView> {
  const receipt = JSON.parse(readFileSync(file, 'utf8')) as SignedReceipt;
  const signatureOk = await verifyReceipt(receipt).then(() => true, () => false);
  const pub = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });
  const r = await pub.readContract({ address: receipt.vault, abi: VAULT_ABI, functionName: 'getReceipt', args: [BigInt(receipt.intent_id)] });
  return {
    receipt, signatureOk,
    onChain: {
      flowIdHashMatch: r.flowIdHash === receipt.flow_id_hash,
      paymentRequestIdHashMatch: r.paymentRequestIdHash === receipt.payment_request_id_hash,
      policyHashMatch: r.policyHash === receipt.policy_hash,
      settledAt: new Date(Number(r.settledAt) * 1000).toISOString(),
    },
    txUrl: `${EXPLORER}/tx/${receipt.settle_tx}`,
    readAt: new Date().toISOString(),
  };
}
