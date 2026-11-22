// Demo scenarios shared by the web console (server.ts) and the headless runner (run-scenarios.ts).
// HSP is the offline mock unless LEASH_HSP=live (pending allowlist). The vault is LocalVault unless
// LEASH_RPC + LEASH_VAULT + LEASH_AGENT_KEY + LEASH_OWNER_KEY are set (ChainVault on HSK testnet).
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { MockHspAdapter } from './hsp/mock.ts';
import type { MockScenario } from './hsp/mock.ts';
import { McpHspAdapter } from './hsp/mcp.ts';
import type { HspTools } from './hsp/types.ts';
import { LocalVault } from './vault.ts';
import type { VaultPort } from './vault.ts';
import { ChainVault } from './chain.ts';
import { MemoryJournal } from './journal.ts';
import { pay, resume } from './flow.ts';
import type { Clock, FlowDeps, FlowEvent, FlowResult, HumanGate } from './flow.ts';
import { dayOf } from './policy.ts';

export const MERCHANT_NAME = 'Leash demo seller';
export const SELLER: Address = '0x5e11e700000000000000000000000000000000a1';
export const UNKNOWN_SELLER: Address = '0x0dd5e11e00000000000000000000000000000b0b';
const USD = 1_000_000n;

export const SCENARIOS = [
  { name: 'happy', title: 'Allowed purchase, two approvals, receipt' },
  { name: 'blocked-merchant', title: 'Seller not on the allowed list' },
  { name: 'over-cap', title: 'Payment above today\'s cap' },
  { name: 'quote-expired', title: 'Quote expired, re-prepare once' },
  { name: 'gateway-30043', title: 'Gateway error 30043, fresh signature' },
  { name: 'stuck-safe', title: 'Stuck at payment-safe for 11 minutes' },
  { name: 'restart', title: 'Agent restarted between prepare and finalize' },
  { name: 'refuse-sign', title: 'Human refuses to sign' },
] as const;

export type ScenarioName = (typeof SCENARIOS)[number]['name'];

/** Virtual clock: 15 s polls take 250 ms of real time so an 11-minute wait plays in ~11 s. */
export function demoClock(speedup = 60): Clock {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    sleep: async (ms) => { const real = Math.min(ms / speedup, 500); await new Promise((r) => setTimeout(r, real)); offset += ms - real; },
  };
}

function vaultFor(clock: Clock): VaultPort {
  const e = process.env;
  if (e.LEASH_RPC && e.LEASH_VAULT && e.LEASH_AGENT_KEY && e.LEASH_OWNER_KEY) {
    return new ChainVault({ rpcUrl: e.LEASH_RPC, chainId: Number(e.LEASH_CHAIN_ID ?? 133), vault: e.LEASH_VAULT as Address, agentKey: e.LEASH_AGENT_KEY as Hex, ownerKey: e.LEASH_OWNER_KEY as Hex });
  }
  return new LocalVault({ dailyCap: 50n * USD, maxPerPayment: 5n * USD, cooldownSec: 0, active: true, merchants: [SELLER] }, () => Math.floor(clock.now() / 1000));
}

async function hspFor(sc: MockScenario, clock: Clock): Promise<HspTools> {
  if (process.env.LEASH_HSP === 'live') {
    const live = new McpHspAdapter();
    await live.connect(); // throws AllowlistPendingError until HSP confirms our egress IP
    return live;
  }
  return new MockHspAdapter(sc, clock.now);
}

export async function runScenario(name: ScenarioName, emit: (e: FlowEvent) => void, human: HumanGate, clock: Clock = demoClock()): Promise<FlowResult> {
  const mock: MockScenario = {
    'quote-expired': { expireFirstQuote: true },
    'gateway-30043': { gateway30043Once: true },
    'stuck-safe': { stuckAtSafe: true },
  }[name as string] ?? {};
  const vault = vaultFor(clock);
  const hsp = await hspFor(mock, clock);
  const payer = privateKeyToAccount(generatePrivateKey()); // demo payer; real runs sign in the OKX Agentic Wallet
  const journal = new MemoryJournal();
  const deps: FlowDeps = {
    hsp, vault, journal, human, clock, emit, merchantName: MERCHANT_NAME,
    wallet: { address: payer.address, signTypedData: (d) => payer.signTypedData(d as never) },
    explorerUrl: (tx) => `https://testnet-explorer.hsk.xyz/tx/${tx}`,
  };
  const merchant = name === 'blocked-merchant' ? UNKNOWN_SELLER : SELLER;
  const amount = name === 'over-cap' ? 3n * USD : 1n * USD;
  if (name === 'over-cap' && vault instanceof LocalVault) vault.spent.set(dayOf(Math.floor(clock.now() / 1000)), 49n * USD);

  emit({ type: 'chat', from: 'buyer', text: 'I need one day of hourly weather data for Seoul. What is your price?' });
  emit({ type: 'chat', from: 'seller', text: `${amount / USD}.00 USD, paid through HSP to ${merchant.slice(0, 6)}...${merchant.slice(-4)}. Quote valid 5 minutes.` });
  emit({ type: 'chat', from: 'buyer', text: 'Checking my owner\'s spending policy before anything moves.' });
  if (name === 'refuse-sign') emit({ type: 'log', level: 'info', text: 'Demo hint: press Refuse on the signing card.' });

  const purchase = { key: `demo-${name}-${Date.now()}`, merchant, item: 'Seoul hourly weather, 1 day', amount };
  if (name !== 'restart') return pay(deps, purchase);

  // restart: the process dies while the human is looking at the signing card
  const crashing: FlowDeps = { ...deps, human: { decide: async () => { throw new Error('agent process killed (simulated)'); } } };
  try { await pay(crashing, purchase); } catch (err) { emit({ type: 'log', level: 'error', text: (err as Error).message }); }
  emit({ type: 'log', level: 'info', text: 'agent restarted; reading its journal' });
  const open = journal.open();
  return resume(deps, open[0]);
}
