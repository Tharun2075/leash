# Leash — 2-minute demo script (target 105-115 s, hard cap 120 s)

Voice: ElevenLabs neutral stock voice (not the owner's). Captions: owner's style, see ../../video-style/CAPTION-STYLE.md.
Every screen is a real recording: https://leash-hsk.pages.dev and hsk.blockscout.com (chain 177). No mock-up UI.
One caption cue = one voice line below.

| # | Screen (real recording) | Voice + caption |
|---|---|---|
| **0:00-0:15 HOOK + HEADLINE** | | |
| 1 | leash-hsk.pages.dev hero | AI agents can now pay for things. |
| 2 | hero | But one bad loop can drain a wallet. |
| 3 | hero headline | Leash gives each agent a budget it cannot overspend. |
| 4 | hero, "HSK Chain mainnet · chain 177" + verified badge | Enforced by a contract on HSK mainnet. |
| **How it works** | | |
| 5 | #how three steps | The owner sets a daily allowance and a per-payment limit. |
| 6 | #how | Plus the shops the agent may pay, and a cooldown. |
| 7 | #how step 2 | The agent must ask the contract before every payment. |
| **Live budget panel** | | |
| 8 | #live budget panel (read from mainnet) | This panel reads the budget live from mainnet. |
| 9 | meter, daily allowance, max per payment | Fifty dollars a day. Five dollars per payment, at most. |
| 10 | "Why blocked?" form: type 9, press "Ask mainnet" (read-only call) | Let's ask the contract about a nine dollar payment. |
| 11 | verdict line | Blocked. It is over the per-payment limit. Reason four. |
| **Blockscout, real transactions** | | |
| 12 | Blockscout tx 0xd89d291a…59f5 (blocked 9 USD) | And here is the real blocked payment, on chain. |
| 13 | same tx, decoded PolicyBlocked reason | Blockscout shows the nine dollar request and the reason it failed. |
| 14 | Blockscout tx 0x8335626d…f456 (allowed 2 USD) | A two dollar payment, inside the budget, goes through. |
| 15 | Blockscout tx 0xe694e2d5…cc06 (owner approve) | Only the owner approves it, from a separate key. |
| **HSP payment steps — labelled "mock (QA access pending)"** | | |
| 16 | #hsp section, badge "HSP mock (QA access pending)" | The payment then runs through HashKey's HSP steps. |
| 17 | HSP step list | Create order, prepare, check the EIP-712 data, then one human approval. |
| 18 | badge close-up | These HSP steps run on a mock while our QA access is pending. |
| 19 | #live receipt panel | The budget contract and the receipts are real mainnet. |
| 20 | receipt checks "All 4 receipt hashes match" | Every settled payment leaves a signed receipt that matches the chain. |
| **Close** | | |
| 21 | hero | Leash. A budget for every AI agent, enforced on HSK mainnet. |

On-screen facts used: PolicyVault 0x736076b308c720d38bb31bdf97e5726ab90f13a9 (verified), budget 50 USD/day, 5 USD per payment,
blocked tx reason 4 OVER_PER_PAYMENT, allowed + approve txs from build/leash/DEPLOYMENTS.md.
