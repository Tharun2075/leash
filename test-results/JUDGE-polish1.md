# JUDGE polish round 1: Leash (2026-11-22)
VERDICT: PASS
| Claim | Observed |
|---|---|
| agent 37/37 | `npm test`: 37 pass, 0 fail, 0 skipped |
| forge 13/13 | `forge test`: 13 passed |
| D1 split | cast call owner() = 0xbB23...3043 (deployer); agent 0x186d...e368 differs. Receipts: requestPayment 0x8335... status success, 0xd89d... reverted, both from the agent. remainingToday(agent)=48.00 USD matches DEPLOYMENTS.md. No tx sent by judge |
| D2 README | "mandate" appears once (line 30, `agent/mandate.ts` in the HSP flow). Budget-first title and intro |
| budget panel + why decoder | code read, tests pass: 5 s cache, 502 on chain failure, /why input capped at 200, read-only |
| deploy/split guards | --mainnet requires chain 177, refuses 177 without it, keys from env only |
| no keys | gitleaks dir on repo and evidence: no leaks. Literal key grep NOT done (secret-get returned nothing in this sandbox) |
Notes (minor): the split script is not idempotent (it re-funds and re-sets policy; fine as a one-shot). The panel lists the deployer address as "First demo agent".
