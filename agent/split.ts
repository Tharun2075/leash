// Owner/agent split on an existing PolicyVault: the owner funds a separate agent key, sets its budget and
// shop list; the agent then makes 1 allowed requestPayment and 1 blocked one (over the per-payment limit,
// sent with a fixed gas limit so the revert lands on chain); the owner approves the allowed one.
// Usage: LEASH_OWNER_KEY=... LEASH_AGENT_KEY=... node agent/split.ts --rpc <url> --vault 0x.. [--fund 0.05] [--mainnet]
// Keys are read from the environment only; never printed or written. Transactions are sent one at a time.
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther, http, keccak256, parseEther, toHex } from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { VAULT_ABI } from './chain.ts';
import { DEMO_POLICY, DEMO_SELLER } from './deploy.ts';
import { REASONS } from './policy.ts';

const hex = (k: string) => (k.startsWith('0x') ? k : `0x${k}`) as Hex;

export async function split(rpcUrl: string, vault: Address, ownerKey: Hex, agentKey: Hex, fund: bigint, mainnet = false) {
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  if (mainnet && chainId !== 177) throw new Error(`refusing: --mainnet given but chain id is ${chainId}, not 177`);
  if (!mainnet && chainId === 177) throw new Error('refusing mainnet (chain 177): pass --mainnet');
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const owner = privateKeyToAccount(ownerKey);
  const agent = privateKeyToAccount(agentKey);
  if (owner.address === agent.address) throw new Error('owner and agent keys are the same');
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const ow = createWalletClient({ chain, transport: http(rpcUrl), account: owner });
  const ag = createWalletClient({ chain, transport: http(rpcUrl), account: agent });
  // HSK mainnet base fee sits on a fixed 500 gwei floor; viem's default max fee (2x base) would demand
  // twice the gas money up front, so cap it at base + 1 gwei.
  const base = (await pub.getBlock()).baseFeePerGas ?? 0n;
  const fees = { maxFeePerGas: base + 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  const onchainOwner = await pub.readContract({ address: vault, abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], functionName: 'owner' });
  if (onchainOwner.toLowerCase() !== owner.address.toLowerCase()) throw new Error(`owner key is not the vault owner (${onchainOwner})`);
  const ownerStart = await pub.getBalance({ address: owner.address });
  const agentStart = await pub.getBalance({ address: agent.address });
  const out: Record<string, unknown> = { chainId, vault, owner: owner.address, agent: agent.address };
  let gasHsk = 0n;
  const wait = async (name: string, hash: Hex, expect: 'success' | 'reverted' = 'success') => {
    const rc = await pub.waitForTransactionReceipt({ hash });
    gasHsk += rc.gasUsed * rc.effectiveGasPrice;
    out[name] = { tx: hash, status: rc.status, gasUsed: rc.gasUsed.toString() };
    if (rc.status !== expect) throw new Error(`${name} ${hash} status ${rc.status}, expected ${expect}`);
    return rc;
  };

  if (agentStart < fund) await wait('fundTx', await ow.sendTransaction({ to: agent.address, value: fund - agentStart, ...fees }));
  await wait('setPolicyTx', await ow.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setPolicy', args: [agent.address, DEMO_POLICY.dailyCap, DEMO_POLICY.maxPerPayment, DEMO_POLICY.cooldown], ...fees }));
  await wait('setMerchantTx', await ow.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setMerchant', args: [agent.address, DEMO_SELLER, true], ...fees }));

  const okAmount = 2_000_000n; // 2.00 USD, inside the 5.00 per-payment limit
  const okRef = keccak256(toHex('leash-mainnet-split:allowed'));
  const { result: intentId, request } = await pub.simulateContract({ account: agent, address: vault, abi: VAULT_ABI, functionName: 'requestPayment', args: [DEMO_SELLER, okAmount, okRef] });
  await wait('allowedRequestTx', await ag.writeContract({ ...request, ...fees }));
  out.intentId = intentId.toString();

  const badAmount = 9_000_000n; // 9.00 USD, over the 5.00 per-payment limit
  const reason = Number(await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'check', args: [agent.address, DEMO_SELLER, badAmount] }));
  if (REASONS[reason] !== 'OVER_PER_PAYMENT') throw new Error(`expected OVER_PER_PAYMENT before the blocked send, got ${REASONS[reason]}`);
  const data = encodeFunctionData({ abi: VAULT_ABI, functionName: 'requestPayment', args: [DEMO_SELLER, badAmount, keccak256(toHex('leash-mainnet-split:blocked'))] });
  await wait('blockedRequestTx', await ag.sendTransaction({ to: vault, data, gas: 60_000n, ...fees }), 'reverted');
  out.blockedReason = REASONS[reason];

  await wait('approveTx', await ow.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'approve', args: [intentId], ...fees }));
  out.remainingToday = (await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'remainingToday', args: [agent.address] })).toString();
  out.gasHsk = formatEther(gasHsk);
  out.ownerSpentHsk = formatEther(ownerStart - (await pub.getBalance({ address: owner.address })));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const ok = process.env.LEASH_OWNER_KEY, ak = process.env.LEASH_AGENT_KEY;
  if (!ok || !ak || !arg('--vault')) { console.error('need LEASH_OWNER_KEY, LEASH_AGENT_KEY and --vault'); process.exit(2); }
  const r = await split(arg('--rpc') ?? 'http://127.0.0.1:8545', arg('--vault') as Address, hex(ok), hex(ak), parseEther(arg('--fund') ?? '0.05'), process.argv.includes('--mainnet') || process.env.HSK_MAINNET === '1');
  console.log(JSON.stringify(r, null, 2));
}
