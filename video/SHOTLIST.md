# Leash demo v3 shot list

Video: leash-demo-v3.mp4, 3840x2160, 30 fps, 88.75 s (v2 88.77 s), AAC 48 kHz voice track reused from v2 (-14.1 LUFS). Captions: Poppins Bold, max 6 words, active word in BRAND.lock highlight.
Real shots: DPR 3 captures, read-only (no buttons pressed on chain pages); Blockscout ad rows and banner hidden. Mid-shot frames: v3-frames/<shot>.png, each checked by eye for rule 1 (whole components, no stray lines, no cut boxes, crisp text).

| Shot | Time (s) | Voice line | Source | What | 4K | Audio | Check |
|---|---|---|---|---|---|---|---|
| s01 | 0.00-5.39 | AI agents can now pay for things. But one bad loop can drain a wallet. | card | track eyebrow + Leash wordmark | yes | yes | ok |
| s02 | 5.39-9.55 | Leash gives each agent a budget it cannot overspend. | card | hero headline | yes | yes | ok |
| s03 | 9.55-12.69 | Enforced by a contract on HSK mainnet. | card | 3 hero pills | yes | yes | ok |
| s04 | 12.69-16.80 | The owner sets a daily allowance and a per-payment limit. | card | how it works step 1 | yes | yes | ok |
| s05 | 16.80-20.85 | Plus the shops the agent may pay, and a cooldown. | card | what is different card 1 | yes | yes | ok |
| s06 | 20.85-24.52 | The agent must ask the contract before every payment. | card | how it works step 2 | yes | yes | ok |
| s07 | 24.52-28.50 | This panel reads the budget live from mainnet. | real | real page: leash-hsk.pages.dev · live budget panel, read from HSK mainnet (site_budget) | yes | yes | ok |
| s08 | 28.50-32.37 | Fifty dollars a day. Five dollars per payment, at most. | card | budget numbers (daily allowance, max per payment) | yes | yes | ok |
| s09 | 32.37-36.15 | Let's ask the contract about a nine dollar payment. | real | real page: leash-hsk.pages.dev · read-only check() call on mainnet (site_decoder) | yes | yes | ok |
| s10 | 36.15-40.94 | Blocked. It is over the per-payment limit. Reason four. | card | "why blocked" result | yes | yes | ok |
| s11 | 40.94-45.54 | And here is the real blocked payment, on chain. | real | real page: hsk.blockscout.com/tx/0xd89d291a…59f5 (tx_blocked) | yes | yes | ok |
| s12 | 45.54-49.88 | Blockscout shows the nine dollar request and the reason it failed. | card | Blockscout decoded input + revert reason (text from Blockscout API) | yes | yes | ok |
| s13 | 49.88-54.23 | A two dollar payment, inside the budget, goes through. | real | real page: hsk.blockscout.com/tx/0x8335626d…f456 (tx_allowed) | yes | yes | ok |
| s14 | 54.23-57.77 | Only the owner approves it, from a separate key. | real | real page: hsk.blockscout.com/tx/0xe694e2d5…cc06 (tx_approve) | yes | yes | ok |
| s15 | 57.77-61.71 | The payment then runs through HashKey's HSP steps. | card | Paying through HSP + badge + step 1 | yes | yes | ok |
| s16 | 61.71-68.83 | Create order, prepare, check the EIP-712 data, then one human approval. | card | HSP steps 2-4 | yes | yes | ok |
| s17 | 68.83-73.70 | These HSP steps run on a mock while our QA access is pending. | card | HSP mock badge + note | yes | yes | ok |
| s18 | 73.70-77.54 | The budget contract and the receipts are real mainnet. | real | real page: leash-hsk.pages.dev · latest signed receipt (site_receipt) | yes | yes | ok |
| s19 | 77.54-83.13 | Every settled payment leaves a signed receipt that matches the chain. | card | receipt check line + step 6 | yes | yes | ok |
| s20 | 83.13-88.75 | Leash. A budget for every AI agent, enforced on HSK mainnet. | card | close: wordmark, headline, 2 pills | yes | yes | ok |
