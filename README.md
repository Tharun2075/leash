# Leash: a budget your AI agent cannot overspend

**Give each AI agent a budget it cannot overspend, enforced on HSK mainnet.**

Leash gives every AI agent its own spending budget, set by its human owner and enforced by a contract
on HSK Chain mainnet: a daily allowance, a per-payment limit, a list of shops it may pay, and a
cooldown. The agent asks the contract before every payment; if the budget says no, the payment is
blocked on chain with a plain reason ("over today's budget", "shop not on the list"), and only the
owner can change the budget. HSK Chain Horizon Hackathon Seoul, Track 2: Agent Payments & A2A Settlement.

**Live on HSK Chain mainnet (chain 177):** budget contract
[`0x736076b308c720d38bb31bdf97e5726ab90f13a9`](https://hsk.blockscout.com/address/0x736076b308c720d38bb31bdf97e5726ab90f13a9)
(source verified on Blockscout). Owner and agent are two different addresses; transactions in `DEPLOYMENTS.md`.

**Hackathon prototype.** Leash is not an electronic financial service, holds no one's keys or funds
(non-custodial), and promises no returns. The mainnet contract only reserves budget and records
receipts; it moves no customer funds.

## What it does

A buyer agent negotiates with a seller agent in a conversational interface. Before any money moves:

1. **Policy first.** An on-chain `PolicyVault` holds the owner's rules for the agent: daily cap,
   per-payment limit, allowed merchants, cooldown. The agent must reserve each payment with
   `requestPayment`; the contract reverts with a reason when the rule says no. The card in the UI
   explains the reason in plain words. Blocked payments never reach HSP.
2. **HSP payment flow: one human approval, before anything is signed.** The HSP Gateway flow is `create_order` ->
   `prepare_payment` -> Leash checks the EIP-712 data against the purchase (primaryType, token contract,
   chain id, recipient = approved merchant = pay_to, sender = our wallet, value = quoted total = the
   policy-checked amount; any mismatch refuses, `agent/mandate.ts`) -> the human approves a card built from
   that checked message -> signature in the payer's wallet -> `finalize_payment` -> `submit_payment`.
   Refusing means no signature and no `finalize_payment`. The approval is also an on-chain `approve` call on the vault.
3. **Honest status.** The agent polls `query_payment` every 15 s. `payment-safe` is shown as
   "confirming"; the word "finalized" appears only after `payment-finalized`. After 10 minutes it
   prints `flow_id` and `payment_request_id`, marks the payment pending, and never places a second order.
4. **Receipt.** On `payment-finalized`, the agent calls `settle`, which mints an on-chain receipt
   binding the intent, the HSP flow, the payment request, the policy hash and the HSP tx hash.

Hard faults handled (tests in `agent/flow.test.ts`):
over daily cap, merchant not allowed, quote older than 5 min, Gateway error 30043 (read from a structured
field; `query_payment` first, then wait until the earlier authorization's `validBefore` has passed before a
new signature; the old one is never resubmitted), stuck at payment-safe, restart between prepare and finalize
(compare-and-set against `query_payment`, conflicts go to the human), refused signature.

## Run

```sh
npm install
export PATH="$HOME/.foundry/bin:$PATH"
(cd contracts && forge build && forge test)
npm test                       # agent tests, incl. a local anvil end-to-end run
npm run demo                   # console at http://127.0.0.1:8787
```

Environment: `HSP_MODE=live|mock` (default `mock`; `LEASH_HSP` is an alias). `live` uses the real HSP MCP
server (needs `HSP_ALLOWLIST_CONFIRMED=1`); `mock` is labelled **"HSP mock (QA access pending)"** in the
console, the event log and every receipt.
`LEASH_RPC`, `LEASH_VAULT`, `LEASH_AGENT_KEY`, `LEASH_OWNER_KEY` switch the vault from the in-memory
mirror to the deployed contract.

## HSP round trip and receipts

One payment runs prepare_payment -> owner signs (EIP-712) -> finalize_payment -> query_payment through
payment-safe ("confirming") to payment-finalized. `agent/mainnet-pay.ts --force expired|30043` also
forces one failure first (an expired quote that is prepared again, or error 30043) and records it.

Receipt design, no PolicyVault redeploy and no extra tx: `PolicyVault.settle()` already stores
keccak(flow_id), keccak(payment_request_id), policyHash and the HSP tx hash in its on-chain Receipt
(`getReceipt`, event `ReceiptMinted`). The plain ids sit in an off-chain JSON receipt
(`receipts/latest-177.json`), signed by the agent key (EIP-191 over canonical JSON) and linked by the
settle tx hash. `GET /receipt` checks the signature and re-checks all three hashes against the chain;
the budget panel shows the result plus the HSP flow state, recorded or live during a run.

Once HashKey allowlists our IP, nothing changes in code:

```sh
HSP_ALLOWLIST_CONFIRMED=1 npm run hsp:live        # one probe, then a live happy-path run; exit 3 while QA still says 403
HSP_ALLOWLIST_CONFIRMED=1 npm run test:hsp-live   # skipped unless QA answers
```

## Demo console security

The console binds to 127.0.0.1 only. Every request must carry Host 127.0.0.1:PORT or localhost:PORT;
POSTs also need a matching Origin, the random per-session token embedded in the page (header
`X-Leash-Token`), and a JSON body of at most 4 KB. Tests: `agent/server.test.ts`.

## Status

- HSP live calls: **pending allowlist.** `agent/hsp/mcp.ts` implements the 8 documented MCP tools
  (get_chain_config, create_order, get_order, prepare_payment, finalize_payment, estimate_fee,
  submit_payment, query_payment) against https://mcp-qa.hashkeymerchant.com/ and refuses to connect
  until the QA allowlist is confirmed. All flows run today against `agent/hsp/mock.ts`, which follows
  the documented shapes and verifies real EIP-712 signatures.
- Contract: tested (forge), deployed and source-verified on HSK Chain mainnet (chain 177) at
  [0x7360…13a9](https://hsk.blockscout.com/address/0x736076b308c720d38bb31bdf97e5726ab90f13a9); separate owner and agent keys; see `DEPLOYMENTS.md`.

## Guardrails we acknowledge

- Uses the HSP Gateway and the EIP-712 payment authorization protocol; the payer signs in their own wallet.
- Non-custodial: no user keys are held; the agent cannot move funds without the human's signature.
- Korean law applies to the host event: Electronic Financial Transactions Act (EFTA), Act on the Protection
  of Virtual Asset Users (VAUPA), and the Supervisory Regulation on Electronic Financial Services
  (IT asset management, vulnerability testing). A prototype cannot disclaim those duties; its mainnet contract
  only reserves budget and records receipts, and it moves no customer funds.
- Agent risk is managed in the spirit of the NIST AI Risk Management Framework (AI RMF): hard limits
  outside the model, human approval at each money step, no fabricated confirmations.
- No private keys or secrets in the repository or logs (checked with gitleaks).

## Reuse

- REUSE: EVM client, EIP-712 signing and verification -> viem (MIT)
- REUSE: MCP client -> @modelcontextprotocol/sdk (MIT)
- REUSE: Ownable -> @openzeppelin/contracts (MIT)
- REUSE: contract tests and local chain -> Foundry forge-std (MIT/Apache-2.0), anvil
- REUSE: test runner and HTTP/SSE server -> Node.js built-ins (`node:test`, `node:http`)

Home-made parts: the policy engine mirror (`agent/policy.ts`, must match the contract bit for bit),
the payment state machine (`agent/flow.ts`, HSP-specific), the HSP mock (`agent/hsp/mock.ts`).

## License

MIT, see `LICENSE`.
