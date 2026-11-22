// End-to-end: real PolicyVault bytecode on a local anvil chain + the agent flow + offline HSP mock.
// Ephemeral random keys, funded with anvil_setBalance; nothing is stored. Skips when anvil is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import type { Hex } from 'viem';
import { deploy, DEMO_SELLER } from './deploy.ts';
import { ChainVault, VAULT_ABI } from './chain.ts';
import { MockHspAdapter } from './hsp/mock.ts';
import { MemoryJournal } from './journal.ts';
import { pay } from './flow.ts';
import type { FlowDeps, FlowEvent } from './flow.ts';

const ANVIL = `${process.env.HOME}/.foundry/bin/anvil`;
const hasAnvil = spawnSync(ANVIL, ['--version']).status === 0;
const PORT = 18545 + Math.floor(Math.random() * 1000);
const RPC = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess | undefined;

before(async () => {
  if (!hasAnvil) return;
  proc = spawn(ANVIL, ['--port', String(PORT), '--chain-id', '31337', '--silent'], { stdio: 'ignore' });
  const pub = createPublicClient({ transport: http(RPC) });
  for (let i = 0; i < 50; i++) { try { await pub.getChainId(); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => proc?.kill());

async function fund(addr: string) {
  await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [addr, '0x56BC75E2D63100000'] }) });
}

test('e2e on anvil: on-chain policy, human approval tx, receipt minted; blocked + refused paths', { skip: !hasAnvil && 'anvil not installed' }, async () => {
  const ownerKey = generatePrivateKey() as Hex;
  const agentKey = generatePrivateKey() as Hex;
  const owner = privateKeyToAccount(ownerKey); const agent = privateKeyToAccount(agentKey);
  await fund(owner.address); await fund(agent.address);
  const d = await deploy(RPC, ownerKey, agent.address);
  const vault = new ChainVault({ rpcUrl: RPC, chainId: 31337, vault: d.vault, agentKey, ownerKey });
  const payer = privateKeyToAccount(generatePrivateKey());
  const mk = (decisions: boolean[]) => {
    const events: FlowEvent[] = [];
    const hsp = new MockHspAdapter({});
    const deps: FlowDeps = {
      hsp, vault, journal: new MemoryJournal(), emit: (e) => events.push(e), merchantName: 'Leash demo seller',
      clock: { now: () => Date.now(), sleep: async () => {} },
      wallet: { address: payer.address, signTypedData: (x) => payer.signTypedData(x as never) },
      human: { decide: async () => decisions.shift() ?? false },
    };
    return { deps, events, hsp };
  };

  const ok = mk([true, true]);
  const r = await pay(ok.deps, { key: 'e2e-1', merchant: DEMO_SELLER, item: 'dataset', amount: 2_000_000n });
  assert.equal(r.outcome, 'settled');
  assert.ok(r.receipt?.chainTx);
  const pub = createPublicClient({ transport: http(RPC) });
  const intent = await pub.readContract({ address: d.vault, abi: VAULT_ABI, functionName: 'getIntent', args: [1n] });
  assert.equal(Number(intent.status), 3); // Settled
  assert.equal(await pub.readContract({ address: d.vault, abi: VAULT_ABI, functionName: 'remainingToday', args: [agent.address] }), 48_000_000n);

  const blocked = mk([true, true]);
  const rb = await pay(blocked.deps, { key: 'e2e-2', merchant: '0xbadbad0000000000000000000000000000000bad', item: 'x', amount: 1_000_000n });
  assert.equal(rb.outcome, 'blocked');
  assert.equal(blocked.hsp.calls.length, 0);

  const refused = mk([false]);
  const rr = await pay(refused.deps, { key: 'e2e-3', merchant: DEMO_SELLER, item: 'x', amount: 1_000_000n });
  assert.equal(rr.outcome, 'refused');
  assert.equal(refused.hsp.callCount('finalize_payment'), 0);
  const i2 = await pub.readContract({ address: d.vault, abi: VAULT_ABI, functionName: 'getIntent', args: [2n] });
  assert.equal(Number(i2.status), 4); // Cancelled, reservation released
  assert.equal(await pub.readContract({ address: d.vault, abi: VAULT_ABI, functionName: 'remainingToday', args: [agent.address] }), 48_000_000n);
});
