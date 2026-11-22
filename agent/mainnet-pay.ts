// One allowed payment on an existing PolicyVault, end to end: top the agent up (canary first), then the
// real flow (policy check, requestPayment, owner approve, HSP round trip, settle on chain) and a signed
// off-chain receipt that keeps the plain HSP ids. HSP runs in HSP_MODE (mock until QA allowlists us).
// Usage: LEASH_OWNER_KEY=... LEASH_AGENT_KEY=... node agent/mainnet-pay.ts --rpc <url> --vault 0x.. [--topup 0.3] [--mainnet] [--out receipts] [--force expired|30043|none]
// --force (mock only) makes the HSP leg fail once on purpose: the first quote expires (default) or the gateway
// answers 30043; the flow prepares again and signs fresh, never resubmitting the old signature.
// Keys are read from the environment only; never printed or written.
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther } from 'viem';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ChainVault, VAULT_ABI } from './chain.ts';
import { DEMO_SELLER } from './deploy.ts';
import { MemoryJournal } from './journal.ts';
import { pay } from './flow.ts';
import type { FlowEvent } from './flow.ts';
import { MockHspAdapter } from './hsp/mock.ts';
import { McpHspAdapter } from './hsp/mcp.ts';
import { hspMode } from './hsp/mode.ts';
import { demoClock } from './scenarios.ts';
import { buildBody, signReceipt, verifyReceipt } from './receipt.ts';

const hex = (k: string) => (k.startsWith('0x') ? k : `0x${k}`) as Hex;
const CANARY = parseEther('0.001');

export async function mainnetPay(rpcUrl: string, vault: Address, ownerKey: Hex, agentKey: Hex, topup: bigint, mainnet: boolean, outDir: string, force: 'expired' | '30043' | 'none' = 'expired') {
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  if (chainId === 177 && !mainnet) throw new Error('refusing mainnet (chain 177): pass --mainnet');
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const owner = privateKeyToAccount(ownerKey), agent = privateKeyToAccount(agentKey);
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const ow = createWalletClient({ chain, transport: http(rpcUrl), account: owner });
  const fees = { maxFeePerGas: ((await pub.getBlock()).baseFeePerGas ?? 0n) + 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  const ownerStart = await pub.getBalance({ address: owner.address });
  const out: Record<string, unknown> = { chainId, vault, owner: owner.address, agent: agent.address, hspMode: hspMode() };

  // Top-up, canary first: 0.001 HSK, prove it landed, then the rest.
  const before = await pub.getBalance({ address: agent.address });
  if (before < topup) {
    const send = async (value: bigint) => {
      const hash = await ow.sendTransaction({ to: agent.address, value, ...fees });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== 'success') throw new Error(`top-up ${hash} failed`);
      return hash;
    };
    const canaryTx = await send(CANARY);
    const seen = await pub.getBalance({ address: agent.address });
    if (seen - before !== CANARY) throw new Error(`canary not seen: agent balance moved by ${formatEther(seen - before)}`);
    const restTx = await send(topup - seen);
    out.topup = { canaryTx, restTx, agentBalance: formatEther(await pub.getBalance({ address: agent.address })) };
  }

  const clock = demoClock();
  const history: { status: string; label: string }[] = [];
  const forced: string[] = [];
  const emit = (e: FlowEvent) => {
    if (e.type === 'status' && history[history.length - 1]?.status !== e.status) history.push({ status: e.status, label: e.label });
    if (e.type === 'log') { console.error(`[${e.level}] ${e.text}`); if (/expired|30043/i.test(e.text)) { forced.push(e.text); history.push({ status: 'forced-failure', label: e.text }); } }
  };
  let hsp;
  if (hspMode() === 'live') { const live = new McpHspAdapter(); await live.connect(); hsp = live; } else hsp = new MockHspAdapter(force === '30043' ? { gateway30043Once: true } : force === 'expired' ? { expireFirstQuote: true } : {}, clock.now);
  const payer = privateKeyToAccount(generatePrivateKey()); // demo payer for the HSP leg; real runs sign in the OKX Agentic Wallet
  const cv = new ChainVault({ rpcUrl, chainId, vault, agentKey, ownerKey });
  const res = await pay({
    hsp, vault: cv, journal: new MemoryJournal(), clock, emit, merchantName: 'Leash demo seller',
    human: { decide: async () => true }, // the owner pre-approved this one run by starting the script
    wallet: { address: payer.address, signTypedData: (d) => payer.signTypedData(d as never) },
    explorerUrl: (tx) => (chainId === 177 ? `https://hsk.blockscout.com/tx/${tx}` : tx),
  }, { key: `leash-mainnet-hsp:${Date.now()}`, merchant: DEMO_SELLER, item: 'one day of hourly Seoul weather', amount: 1_000_000n });
  if (res.outcome !== 'settled' || !res.receipt) throw new Error(`flow ended ${res.outcome}`);
  const r = res.receipt;

  const onchain = await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'getReceipt', args: [BigInt(r.intentId)] }) as { flowIdHash: Hex; paymentRequestIdHash: Hex; policyHash: Hex; hspTxHash: Hex };
  const body = buildBody({
    hsp_mode: hspMode(), chain_id: chainId, vault, intent_id: r.intentId, settle_tx: r.chainTx as Hex,
    flow_id: res.flowId!, payment_request_id: res.paymentRequestId!, policy_hash: onchain.policyHash, hsp_tx_hash: onchain.hspTxHash,
    hsp_status_history: history, agent: agent.address, issued_at: new Date().toISOString(),
  });
  if (body.flow_id_hash !== onchain.flowIdHash || body.payment_request_id_hash !== onchain.paymentRequestIdHash) throw new Error('on-chain receipt hashes do not match the HSP ids');
  const signed = await signReceipt(agent, body);
  await verifyReceipt(signed);
  mkdirSync(outDir, { recursive: true });
  const text = JSON.stringify(signed, null, 2) + '\n';
  writeFileSync(join(outDir, `${chainId}-${r.chainTx}.json`), text);
  writeFileSync(join(outDir, `latest-${chainId}.json`), text);
  out.intentId = r.intentId; out.settleTx = r.chainTx; out.flowId = res.flowId; out.paymentRequestId = res.paymentRequestId;
  out.forcedFailure = forced;
  out.statuses = history.map((h) => h.status).join(' > ');
  out.ownerSpentHsk = formatEther(ownerStart - (await pub.getBalance({ address: owner.address })));
  out.agentLeftHsk = formatEther(await pub.getBalance({ address: agent.address }));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const ok = process.env.LEASH_OWNER_KEY, ak = process.env.LEASH_AGENT_KEY;
  if (!ok || !ak || !arg('--vault')) { console.error('need LEASH_OWNER_KEY, LEASH_AGENT_KEY and --vault'); process.exit(2); }
  const r = await mainnetPay(arg('--rpc') ?? 'http://127.0.0.1:8545', arg('--vault') as Address, hex(ok), hex(ak), parseEther(arg('--topup') ?? '0.3'), process.argv.includes('--mainnet'), arg('--out') ?? 'receipts', (arg('--force') ?? 'expired') as 'expired' | '30043' | 'none');
  console.log(JSON.stringify(r, null, 2));
}
