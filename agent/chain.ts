// ChainVault: VaultPort over the deployed PolicyVault (HSK Chain testnet, chain id 133, or a local anvil).
// Keys come from the environment at runtime only (LEASH_AGENT_KEY, LEASH_OWNER_KEY); never logged, never written.
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, BaseError, ContractFunctionRevertedError } from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PolicyVerdict } from './policy.ts';
import { REASONS, formatUsd } from './policy.ts';
import type { Receipt, VaultPort } from './vault.ts';
import { PolicyBlockedError, idHash } from './vault.ts';

export const hskTestnet = defineChain({
  id: 133,
  name: 'HSK Chain Testnet',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
  blockExplorers: { default: { name: 'HSK testnet explorer', url: 'https://testnet-explorer.hsk.xyz' } },
  testnet: true,
});

export const VAULT_ABI = parseAbi([
  'function check(address agent, address merchant, uint256 amount) view returns (uint8)',
  'function remainingToday(address agent) view returns (uint256)',
  'function policyHash(address agent) view returns (bytes32)',
  'function policies(address) view returns (uint256 dailyCap, uint256 maxPerPayment, uint64 cooldown, bool active)',
  'function getIntent(uint256) view returns ((address agent, address merchant, uint256 amount, uint64 createdAt, uint32 day, uint8 status, bytes32 quoteRef))',
  'function setPolicy(address agent, uint256 dailyCap, uint256 maxPerPayment, uint64 cooldown)',
  'function setMerchant(address agent, address merchant, bool allowed)',
  'function requestPayment(address merchant, uint256 amount, bytes32 quoteRef) returns (uint256)',
  'function approve(uint256 intentId)',
  'function cancel(uint256 intentId)',
  'function settle(uint256 intentId, bytes32 flowIdHash, bytes32 paymentRequestIdHash, bytes32 hspTxHash)',
  'error PolicyBlocked(uint8 reason)',
  'error NotAgent()',
  'error BadStatus(uint8 current)',
  'error NotOwnerOrAgent()',
  'event PaymentRequested(uint256 indexed intentId, address indexed agent, address indexed merchant, uint256 amount, bytes32 quoteRef)',
]);

const STATUS = ['None', 'Pending', 'Approved', 'Settled', 'Cancelled'] as const;

export interface ChainVaultOpts { rpcUrl: string; chainId: number; vault: Address; agentKey: Hex; ownerKey: Hex }

export class ChainVault implements VaultPort {
  pub; agentWallet; ownerWallet; vault: Address; agent: Address; chain;
  lastTx: Hex | undefined;

  constructor(o: ChainVaultOpts) {
    this.chain = o.chainId === 133 ? hskTestnet : defineChain({ id: o.chainId, name: 'local', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [o.rpcUrl] } } });
    const transport = http(o.rpcUrl);
    this.pub = createPublicClient({ chain: this.chain, transport });
    const agentAcct = privateKeyToAccount(o.agentKey);
    this.agent = agentAcct.address;
    this.agentWallet = createWalletClient({ chain: this.chain, transport, account: agentAcct });
    this.ownerWallet = createWalletClient({ chain: this.chain, transport, account: privateKeyToAccount(o.ownerKey) });
    this.vault = o.vault;
  }

  private async send(who: 'agent' | 'owner', functionName: string, args: unknown[]): Promise<{ hash: Hex; result: unknown }> {
    const wallet = who === 'agent' ? this.agentWallet : this.ownerWallet;
    try {
      const { request, result } = await this.pub.simulateContract({ address: this.vault, abi: VAULT_ABI, functionName: functionName as never, args: args as never, account: wallet.account });
      const hash = await wallet.writeContract(request as never);
      const rc = await this.pub.waitForTransactionReceipt({ hash });
      if (rc.status !== 'success') throw new Error(`${functionName} reverted in tx ${hash}`);
      this.lastTx = hash;
      return { hash, result };
    } catch (err) {
      if (err instanceof BaseError) {
        const rev = err.walk((e) => e instanceof ContractFunctionRevertedError);
        if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName === 'PolicyBlocked') {
          throw new PolicyBlockedError(REASONS[Number(rev.data.args?.[0])]);
        }
      }
      throw err;
    }
  }

  async verdict(merchant: string, amount: bigint): Promise<PolicyVerdict> {
    const [code, remaining, s] = await Promise.all([
      this.pub.readContract({ address: this.vault, abi: VAULT_ABI, functionName: 'check', args: [this.agent, merchant as Address, amount] }),
      this.pub.readContract({ address: this.vault, abi: VAULT_ABI, functionName: 'remainingToday', args: [this.agent] }),
      this.policySummary(),
    ]);
    const reason = REASONS[Number(code)];
    const explain = reason === 'OK'
      ? `Allowed: ${formatUsd(remaining - amount)} of ${formatUsd(s.dailyCap)} left today after this payment (checked on-chain).`
      : `Blocked on-chain: ${reason.replaceAll('_', ' ').toLowerCase()} (${formatUsd(amount)}, ${formatUsd(remaining)} left today).`;
    return { reason, allowed: reason === 'OK', remainingToday: remaining, explain };
  }

  async policySummary() {
    const [dailyCap, maxPerPayment] = await this.pub.readContract({ address: this.vault, abi: VAULT_ABI, functionName: 'policies', args: [this.agent] });
    return { dailyCap, maxPerPayment };
  }

  async requestPayment(merchant: string, amount: bigint, quoteRef: string) {
    const { result } = await this.send('agent', 'requestPayment', [merchant, amount, quoteRef]);
    return String(result);
  }

  async approve(intentId: string) { await this.send('owner', 'approve', [BigInt(intentId)]); }
  async cancel(intentId: string) { await this.send('agent', 'cancel', [BigInt(intentId)]); }

  async settle(intentId: string, flowId: string, paymentRequestId: string, hspTxHash: string): Promise<Receipt> {
    const tx = /^0x[0-9a-fA-F]{64}$/.test(hspTxHash) ? hspTxHash : idHash(hspTxHash);
    const { hash } = await this.send('agent', 'settle', [BigInt(intentId), idHash(flowId), idHash(paymentRequestId), tx]);
    const policyHash = await this.pub.readContract({ address: this.vault, abi: VAULT_ABI, functionName: 'policyHash', args: [this.agent] });
    return { intentId, flowIdHash: idHash(flowId), paymentRequestIdHash: idHash(paymentRequestId), policyHash, hspTxHash: tx, chainTx: hash };
  }

  async intentStatus(intentId: string) {
    const i = await this.pub.readContract({ address: this.vault, abi: VAULT_ABI, functionName: 'getIntent', args: [BigInt(intentId)] });
    return STATUS[Number(i.status)];
  }
}
