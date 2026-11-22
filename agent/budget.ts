// Live budget read for the console's budget panel: per agent, the policy and remainingToday() straight from the vault.
import { createPublicClient, http, isAddress } from 'viem';
import type { Address } from 'viem';
import { VAULT_ABI } from './chain.ts';
import { formatUsd } from './policy.ts';

export const MAINNET_RPC = 'https://mainnet.hsk.xyz';
export const MAINNET_VAULT: Address = '0x736076b308c720d38bb31bdf97e5726ab90f13a9';
export const EXPLORER = 'https://hsk.blockscout.com';
/** Default panel: the split agent, the deployer's first demo budget, and one agent with no budget yet. */
export const DEFAULT_AGENTS: { label: string; address: Address }[] = [
  { label: 'Shopping agent', address: '0x186d6E32EB784e3483acb56acc1c560Eeb49e368' },
  { label: 'First demo agent (deployer key)', address: '0xbB23B962F512b8fD9fb1B0311bd6d8F0fbb93043' },
  { label: 'New agent (no budget yet)', address: '0x000000000000000000000000000000000000dEaD' },
];

export interface AgentBudget {
  label: string; address: Address; active: boolean;
  dailyCap: string; maxPerPayment: string; remainingToday: string; cooldownSec: number; remainingPct: number; url: string;
}
export interface BudgetReport { chainId: number; vault: Address; readAt: string; agents: AgentBudget[]; vaultUrl: string }

/** "Label=0xabc,Label2=0xdef" -> agent list (max 3); bad entries are dropped. */
export function parseAgents(spec: string | undefined): { label: string; address: Address }[] {
  if (!spec) return DEFAULT_AGENTS;
  const list = spec.split(',').map((p) => p.split('=')).filter(([l, a]) => l && a && isAddress(a.trim()))
    .map(([l, a]) => ({ label: l.trim(), address: a.trim() as Address }));
  return list.length ? list.slice(0, 3) : DEFAULT_AGENTS;
}

export async function readBudgets(rpcUrl = MAINNET_RPC, vault: Address = MAINNET_VAULT, agents = DEFAULT_AGENTS): Promise<BudgetReport> {
  const pub = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });
  const chainId = await pub.getChainId();
  const rows = await Promise.all(agents.slice(0, 3).map(async ({ label, address }) => {
    const [[dailyCap, maxPerPayment, cooldown, active], remaining] = await Promise.all([
      pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'policies', args: [address] }),
      pub.readContract({ address: vault, abi: VAULT_ABI, functionName: 'remainingToday', args: [address] }),
    ]);
    const pct = active && dailyCap > 0n ? Number((remaining * 1000n) / dailyCap) / 10 : 0;
    return {
      label, address, active, dailyCap: formatUsd(dailyCap), maxPerPayment: formatUsd(maxPerPayment),
      remainingToday: formatUsd(active ? remaining : 0n), cooldownSec: Number(cooldown), remainingPct: pct,
      url: `${EXPLORER}/address/${address}`,
    };
  }));
  return { chainId, vault, readAt: new Date().toISOString(), agents: rows, vaultUrl: `${EXPLORER}/address/${vault}` };
}
