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
- PolicyVault 0x736076b308c720d38bb31bdf97e5726ab90f13a9, owner = agent = deployer 0xbB23B962F512b8fD9fb1B0311bd6d8F0fbb93043, demo seller allowed 0x5e11e700000000000000000000000000000000a1
- deployTx https://hsk.blockscout.com/tx/0x35dd4480f0d70fc672b2cd86366e3f6a230c918df75284256c6b233ee8103975
- setPolicyTx https://hsk.blockscout.com/tx/0x8850836aa237d63a820269bcfeeb130757d1c21781cfc7e5221ac32011025115
- setMerchantTx https://hsk.blockscout.com/tx/0x28b15ef7c5a45197509fced2bca4783dc3f84221bfca3b53e69a18b0f6b19acd
- verified: yes (forge verify-contract --verifier blockscout --verifier-url https://hsk.blockscout.com/api/)
- spent 0.666011129 HSK; mainnet base fee is a fixed 500 gwei floor
- how: `LEASH_DEPLOYER_KEY="$(secret-get hsk-horizon-deployer privkey)" node agent/deploy.ts --rpc https://mainnet.hsk.xyz --mainnet` (fork canary first: anvil --fork-url https://mainnet.hsk.xyz)
- evidence: ../../evidence/deploy/fork-leash.log, mainnet-leash.log, verify-leash.log
