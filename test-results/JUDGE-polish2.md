VERDICT: PASS

# Judge: Leash HSP round trip + receipt fields (fc97bdf..6ba97cb)
Read and run only. No mainnet txs sent; chain reads only. Demo run on PORT=8799 (8787 was taken).

| Claim | Observed |
|---|---|
| Agent tests 40 pass / 1 skip, forge 13/13 | reproduced |
| gitleaks clean | reproduced |
| HSP_MODE=live\|mock, default mock, bad value throws | agent/hsp/mode.ts confirms |
| Live not faked | hsp-live.ts probes once, exits 3 on 403; live test skipped unless HSP_LIVE_TEST=1 + HSP_ALLOWLIST_CONFIRMED=1 |
| settle() stores flow/payment-request hashes next to policyHash | keccak recomputed; match calldata, getReceipt and ReceiptMinted of tx 0x82b597ec..678b |
| Signed receipt latest-177.json verified | signer recovers to agent key; /receipt re-checks against chain |
| Mock label visible | UI pill, event log, README line 56, DEPLOYMENTS, every receipt |
| Mock replies follow docs | shapes, EIP-712 verification, 30043/expiry behaviour match PITFALLS.md and docs pages (tx_signature, attribution_verified, statuses) |
| The 404 | /favicon.ico (no icon link); cosmetic |

## Frauds
None major. Doc/receipt mismatch below.

## Fix lines (minor, none block PASS)
1. Fix: add `<link rel="icon" href="data:,">` to ui/index.html (removes the favicon 404 the builder skipped).
2. Fix: README and DEPLOYMENTS say the forced failure is "recorded", but the signed `hsp_status_history` holds status events only. Either add a forced-failure entry to the history in agent/mainnet-pay.ts, or reword the docs to "was exercised".
3. Fix: history shows `payment-submitted` twice; dedupe in mainnet-pay.ts.

## Unverifiable
Video-facing text: no script or captions were in the READ list; the label could not be checked there. Live HSP itself is unreachable (QA 403), correctly reported as such.
