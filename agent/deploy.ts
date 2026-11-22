// Deploy PolicyVault and set the demo policy. One code path for local anvil and HSK testnet (chain 133).
// Usage: LEASH_DEPLOYER_KEY=... node agent/deploy.ts --rpc https://testnet.hsk.xyz [--agent 0x..] [--seller 0x..]
// The key is read from the environment only; never printed or written. Mainnet (chain 177) is refused unless
// the caller opts in with --mainnet (or HSK_MAINNET=1); with the opt-in, every chain other than 177 is refused.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { VAULT_ABI } from './chain.ts';

export const DEMO_SELLER: Address = '0x5e11e700000000000000000000000000000000a1';
export const DEMO_POLICY = { dailyCap: 50_000_000n, maxPerPayment: 5_000_000n, cooldown: 0n };

export function artifact(): { abi: unknown[]; bytecode: Hex } {
  const p = fileURLToPath(new URL('../contracts/out/PolicyVault.sol/PolicyVault.json', import.meta.url));
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export async function deploy(rpcUrl: string, key: Hex, agent?: Address, seller: Address = DEMO_SELLER, mainnet = false) {
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  if (mainnet && chainId !== 177) throw new Error(`refusing: --mainnet given but chain id is ${chainId}, not 177`);
  if (!mainnet && chainId === 177) throw new Error('refusing mainnet (chain 177): pass --mainnet (owner decision required)');
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ chain, transport: http(rpcUrl), account });
  const a = artifact();
  const deployTx = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args: [account.address] });
  const rc = await pub.waitForTransactionReceipt({ hash: deployTx });
  const vault = rc.contractAddress as Address;
  const agentAddr = agent ?? account.address;
  const setPolicyTx = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setPolicy', args: [agentAddr, DEMO_POLICY.dailyCap, DEMO_POLICY.maxPerPayment, DEMO_POLICY.cooldown] });
  await pub.waitForTransactionReceipt({ hash: setPolicyTx });
  const setMerchantTx = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'setMerchant', args: [agentAddr, seller, true] });
  await pub.waitForTransactionReceipt({ hash: setMerchantTx });
  return { chainId, vault, owner: account.address, agent: agentAddr, deployTx, setPolicyTx, setMerchantTx, block: rc.blockNumber, gasUsed: rc.gasUsed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const key = process.env.LEASH_DEPLOYER_KEY as Hex | undefined;
  if (!key) { console.error('LEASH_DEPLOYER_KEY not set'); process.exit(2); }
  const r = await deploy(arg('--rpc') ?? 'https://testnet.hsk.xyz', key.startsWith('0x') ? key : (`0x${key}` as Hex), arg('--agent') as Address | undefined, (arg('--seller') as Address) ?? DEMO_SELLER, process.argv.includes('--mainnet') || process.env.HSK_MAINNET === '1');
  console.log(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}
