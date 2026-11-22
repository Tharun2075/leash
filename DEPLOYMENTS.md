# Deployments

| Network | Chain id | PolicyVault | Deploy tx | Status |
|---|---|---|---|---|
| HSK Chain testnet | 133 | none yet | none yet | BLOCKED: deployer 0xbB23B962F512b8fD9fb1B0311bd6d8F0fbb93043 has 0 HSK; faucet https://faucet.hsk.xyz/ shows a reCAPTCHA v2 (owner step). Evidence: test-results/evidence/faucet-captcha.txt |
| Local anvil | 31337 | random per run | random per run | PROVEN: agent/e2e.anvil.test.ts deploys the real bytecode, sets the policy, runs settled / blocked / refused |
| HSK Chain mainnet | 177 | [0x736076b308c720d38bb31bdf97e5726ab90f13a9](https://hsk.blockscout.com/address/0x736076b308c720d38bb31bdf97e5726ab90f13a9) | [0x35dd4480…3975](https://hsk.blockscout.com/tx/0x35dd4480f0d70fc672b2cd86366e3f6a230c918df75284256c6b233ee8103975) | DEPLOYED 2026-11-22 ~18:30Z block 30512486, source VERIFIED on Blockscout, gas spent 0.666011 HSK (3 txs @ 500 gwei floor) |

## How to deploy to testnet once the deployer has HSK

```sh
export PATH="$HOME/.foundry/bin:$PATH"
(cd contracts && forge build)
LEASH_DEPLOYER_KEY="$(secret-get hsk-horizon-deployer privkey)" node agent/deploy.ts --rpc https://testnet.hsk.xyz
```

The key lives only in the environment of that one command. Record the printed `vault`, `deployTx`,
`setPolicyTx`, `setMerchantTx` in the table above, with the explorer link
https://testnet-explorer.hsk.xyz/tx/<hash>.

## HSK mainnet (chain 177), 2026-11-22
- PolicyVault 0x736076b308c720d38bb31bdf97e5726ab90f13a9, at deploy owner = agent = deployer (split below) 0xbB23B962F512b8fD9fb1B0311bd6d8F0fbb93043, demo seller allowed 0x5e11e700000000000000000000000000000000a1
- deployTx https://hsk.blockscout.com/tx/0x35dd4480f0d70fc672b2cd86366e3f6a230c918df75284256c6b233ee8103975
- setPolicyTx https://hsk.blockscout.com/tx/0x8850836aa237d63a820269bcfeeb130757d1c21781cfc7e5221ac32011025115
- setMerchantTx https://hsk.blockscout.com/tx/0x28b15ef7c5a45197509fced2bca4783dc3f84221bfca3b53e69a18b0f6b19acd
- verified: yes (forge verify-contract --verifier blockscout --verifier-url https://hsk.blockscout.com/api/)
- spent 0.666011129 HSK; mainnet base fee is a fixed 500 gwei floor
- how: `LEASH_DEPLOYER_KEY="$(secret-get hsk-horizon-deployer privkey)" node agent/deploy.ts --rpc https://mainnet.hsk.xyz --mainnet` (fork canary first: anvil --fork-url https://mainnet.hsk.xyz)
- evidence: ../../evidence/deploy/fork-leash.log, mainnet-leash.log, verify-leash.log

## Owner/agent split on mainnet, 2026-11-22
- owner (human, vault owner) 0xbB23B962F512b8fD9fb1B0311bd6d8F0fbb93043 != agent 0x186d6E32EB784e3483acb56acc1c560Eeb49e368 (key: `secret-get leash-agent privkey`)
- agent budget: 50.00 USD/day, 5.00 USD per payment, cooldown 0, shop 0x5e11e700000000000000000000000000000000a1
- fund agent 0.15 HSK: https://hsk.blockscout.com/tx/0x35c2b4df41bd0cc9985685a3f578d354244d88b656dcd1a31b5e86c2ae151ac5
- owner setPolicy: https://hsk.blockscout.com/tx/0xa5a10e0f3e94de83b1dfe2d482a9dc19a998c9f00fcb2fb2053cb637ed299152
- owner setMerchant: https://hsk.blockscout.com/tx/0x9f347bf9f17cfcb46e24c52129e10a6774a6b0475aedc9c1372166af0ed5a821
- agent requestPayment 2.00 USD, ALLOWED, PaymentRequested intent 1: https://hsk.blockscout.com/tx/0x8335626dfe4ac434027c5b2e8d0c3823f4a039553f9883b34daa4dbe8030f456
- agent requestPayment 9.00 USD, BLOCKED, reverted PolicyBlocked(reason=4 OVER_PER_PAYMENT), decoded on Blockscout: https://hsk.blockscout.com/tx/0xd89d291a4b6f396993f6d42b00a23a03f424ce82f6c75fe29016f838873259f5
- owner approve intent 1: https://hsk.blockscout.com/tx/0xe694e2d55f1a840404844128e9c8cf798bf00f59f7fcc367d13726df5891cc06
- after: remainingToday(agent) = 48.00 USD; gas burned 0.210427 HSK (420,009 gas @ 501 gwei); deployer out 0.246631 HSK incl. 0.15 funding; agent keeps 0.036 HSK
- note: a blocked payment is a revert (no state change, so no event log); Blockscout shows the decoded PolicyBlocked(reason) on the failed tx
- how: `LEASH_OWNER_KEY="$(secret-get hsk-horizon-deployer privkey)" LEASH_AGENT_KEY="$(secret-get leash-agent privkey)" node agent/split.ts --rpc https://mainnet.hsk.xyz --vault 0x7360…13a9 --fund 0.15 --mainnet` (fork canary first: anvil --fork-url https://mainnet.hsk.xyz --block-base-fee-per-gas 500000000000)
- evidence: ../../evidence/deploy/fork-leash-split.log, mainnet-leash-split.log

## HSP receipt run (HSP mock (QA access pending)), 2026-11-22
- agent top-up to 0.3 HSK, canary: https://hsk.blockscout.com/tx/0x6573b362771155a2a64ba2475a59c79371e0086918aad974015a1e04f98ffbc2
- agent top-up, rest: https://hsk.blockscout.com/tx/0x3e5ad679e3ab65c00556435279ef546fe851354e565de5ce671c325c7d0a1eab
- intent 2 allowed and settled with HSP ids flow_id=mock-flow-1, payment_request_id=mock-pr-1 (block 30515431): https://hsk.blockscout.com/tx/0x82b597ec2ead6427af134c75fc10c4d9123c82139b4aa9e4c78736b49921678b
- forced failure first: quote expired, prepared again; then payment-safe -> payment-finalized
- signed receipt: receipts/latest-177.json (signer = agent); on-chain getReceipt hashes match flow_id, payment_request_id and policyHash
- deployer out 0.29999 HSK (cap 0.6); how: `LEASH_OWNER_KEY="$(secret-get hsk-horizon-deployer privkey)" LEASH_AGENT_KEY="$(secret-get leash-agent privkey)" node agent/mainnet-pay.ts --rpc https://mainnet.hsk.xyz --vault 0x7360…13a9 --mainnet --out receipts --topup 0.3`
