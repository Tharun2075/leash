# Deployments

| Network | Chain id | PolicyVault | Deploy tx | Status |
|---|---|---|---|---|
| HSK Chain testnet | 133 | none yet | none yet | BLOCKED: deployer 0xbB23B962F512b8fD9fb1B0311bd6d8F0fbb93043 has 0 HSK; faucet https://faucet.hsk.xyz/ shows a reCAPTCHA v2 (owner step). Evidence: test-results/evidence/faucet-captcha.txt |
| Local anvil | 31337 | random per run | random per run | PROVEN: agent/e2e.anvil.test.ts deploys the real bytecode, sets the policy, runs settled / blocked / refused |
| HSK Chain mainnet | 177 | none | none | NOT DEPLOYED. agent/deploy.ts refuses chain 177; mainnet needs an owner decision |

## How to deploy to testnet once the deployer has HSK

```sh
export PATH="$HOME/.foundry/bin:$PATH"
(cd contracts && forge build)
LEASH_DEPLOYER_KEY="$(secret-get hsk-horizon-deployer privkey)" node agent/deploy.ts --rpc https://testnet.hsk.xyz
```

The key lives only in the environment of that one command. Record the printed `vault`, `deployTx`,
`setPolicyTx`, `setMerchantTx` in the table above, with the explorer link
https://testnet-explorer.hsk.xyz/tx/<hash>.
