# ⚔️ Battle Vaults — The Agora

**Two AI agents run two vaults on the same capital base. A MetaAllocator routes fresh deposits to
whichever agent's NAV is winning — behind one shared, merkle-bounded guardrail. Settled on Arc,
gas in USDC.**

> Agora Agents Hackathon · **RFB 04 — Adaptive Portfolio Manager**. The pitch: *you don't trust an
> AI with money — you bound it cryptographically — and then you let two of them compete for the
> leaderboard.* See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

<!-- replace OWNER/REPO after pushing -->
![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)

**8/8 tests pass** (`forge test`), contracts compile (`forge build`), the off-chain stack typechecks (`tsc`). The headline test — [`GuardrailTest`](./contracts/test/GuardrailTest.t.sol) — proves the agent's *identical* call reverts on-chain when the recipient isn't in its merkle root (the "bounded AI" thesis).

## The two agents (Arc-native)

Arc Testnet has no DEX or perps — the venues are **USYC** (tokenized T-bills), **StableFX**
(USDC↔EURC FX), and **CCTP / Gateway** (cross-chain USDC). So the agents compete on Arc-native
strategies, with Arc as the treasury + decision ledger:

- **RegimeShift** — a regime classifier (trend / vol / carry, with hysteresis). Risk-off → park in
  **USYC**. Risk-on → bridge USDC to a sister risk vault on another chain via **CCTP**.
- **CarryFarm** — holds a **USYC** T-bill base and rotates a sleeve **USDC↔EURC via StableFX** when
  the FX carry clears the floor. Steady, low-vol — the foil to RegimeShift's high beta.

Both share the *same* guardrail design, which is the whole point: the safety layer is
strategy-agnostic, so you can hot-swap AI brains without touching the vault.

## Why this scores

- **Agentic (30%)** — an LLM agent makes the call each cycle (choosing actions from the bounded
  menu and sizing them), with a deterministic rule engine as fallback; every decision's reasoning
  is hashed + pinned on-chain in the **AgentJournal** ("reasoning trace as the product"). The merkle
  guardrail is what makes that autonomy safe — the agent is bounded both off-chain and on-chain.
- **Circle tools (20%)** — USYC, StableFX (USDC/EURC), CCTP v2, Gateway, USDC-as-gas, all native.
- **Cross-chain coordination** — exactly what RFB 04 asks for, via CCTP.
- **Arc OSS Showcase** — the merkle-bounded agent guardrail is a clean, forkable primitive (submit
  via the ARC CLI with an `ArcOSS:` message).

## Layout

```
battle-vaults/
├── contracts/                 Foundry project (EVM — deploys on Arc unchanged)
│   ├── src/
│   │   ├── BoringVault.sol                     holds assets, mints shares, executes manage()
│   │   ├── ManagerWithMerkleVerification.sol   THE guardrail (merkle-bounded execution)
│   │   ├── Accountant.sol                      NAV + rate bounds + high-water mark
│   │   ├── Teller.sol                          deposit / withdraw (AUM + #users events)
│   │   ├── MetaAllocator.sol                   routes capital to the winner; BATTLE share
│   │   ├── SimpleRolesAuthority.sol            capability wiring
│   │   ├── AgentJournal.sol                    on-chain reasoning log (hash + IPFS CID per cycle)
│   │   └── decoders/
│   │       ├── BaseDecoderAndSanitizer.sol     approve / transfer
│   │       ├── RegimeDecoderAndSanitizer.sol   USYC buy/sell + CCTP depositForBurn
│   │       └── CarryDecoderAndSanitizer.sol    USYC buy/sell + StableFX settle
│   ├── script/Deploy.s.sol                     deploys + wires both stacks on Arc
│   └── test/BattleVaults.t.sol                 routing + breaker + accountant tests
├── offchain/                  TypeScript brains + keepers
│   └── src/
│       ├── config.ts          Arc Testnet chain + verified Circle addresses
│       ├── merkle/            leaf hashing (matches the contract), tree, Arc action bundles
│       ├── signals/           regime classifier, FX carry reader
│       ├── strategists/       RegimeShift + CarryFarm rule engines + action-arg builder
│       ├── llm/               LLM agent (decides from the allowed menu) + reasoning hash / pin
│       └── keeper/            runStrategist (LLM decide → execute → journal) + metaAllocator
└── dashboard/index.html       The Agora — live NAV-race scoreboard (open in a browser)
```

## Arc Testnet — verified addresses

| Thing | Value |
|---|---|
| Chain ID | `5042002` · RPC `https://rpc.testnet.arc.network` · gas in **USDC** |
| Explorer / Faucet | `testnet.arcscan.app` · `faucet.circle.com` |
| USDC (ERC-20, 6 dp) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| USYC · Teller | `0xe918…b86C` · `0x9fdF…105A` |
| CCTP v2 TokenMessenger (domain 26) | `0x8FE6…2DAA` |
| Gateway Wallet / Minter | `0x0077…19B9` / `0x0022…475B` |
| StableFX FxEscrow · Permit2 | `0x8676…a9f8` · `0x0000…8BA3` |

## Quick start

**1. Dashboard (zero setup — for the demo video).** Open `dashboard/index.html` in a browser. It
runs a market simulation so the NAV race, capital routing, and circuit-breaker animate live. To
read **live on-chain data** instead, append query params after deploy:
`index.html?allocator=0x…&journal=0x…&regime=0x…&carry=0x…` (it polls the MetaAllocator + AgentJournal on Arc).

**2. Generate merkle roots** (after filling deployed addresses in `offchain/src/config.ts`):
```bash
cd offchain && npm install
npm run build-tree            # writes roots.json -> REGIME_ROOT / CARRY_ROOT
npm run typecheck
```

**3. Deploy on Arc Testnet** (gas paid in USDC — fund the deployer from faucet.circle.com):
```bash
cd contracts
forge install foundry-rs/forge-std transmissions11/solmate OpenZeppelin/openzeppelin-contracts@v5.1.0
# env: PRIVATE_KEY, USDC=0x3600..., REGIME_STRATEGIST, CARRY_STRATEGIST, ORACLE, REGIME_ROOT, CARRY_ROOT
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
forge test -vvv
```

**4. Run the agents** (fill deployed addresses into `config.ts` first):
```bash
cd offchain
npm run regime                # dry-run: LLM decides, prints reasoning + the merkle-bounded calls
tsx src/keeper/runStrategist.ts carry   # CarryFarm dry-run
# LLM decides when ANTHROPIC_API_KEY is set; without it, the deterministic rule engine runs:
ANTHROPIC_API_KEY=sk-... EXECUTE=1 STRATEGIST_PK=0x... npm run regime
npm run price                 # NAV pricer: value holdings -> push Accountant rate (the scoreboard spine)
EXECUTE=1 ORACLE_PK=0x... npm run price          # actually push NAV on-chain (deviation-guarded)
npm run allocator             # print the live scoreboard;  ROLL=1 ALLOCATOR_PK=0x... to roll the epoch
```

## Security notes

- **Leaf parity**: `ManagerWithMerkleVerification._verifyCall` (Solidity) and `merkle/leaf.ts` must
  hash identically. Verified for all current action shapes (empty-arg `buy`/`sell`, 1-address
  `approve`, 2-address `depositForBurn` / `settle`). Change one side → change both → rebuild roots.
- **Verify ABIs on arcscan** before wiring real funds: the USYC Teller `deposit`/`redeem` (Circle docs ABI), the
  StableFX `FxEscrow` settlement shape, and CCTP `depositForBurn`. The bundles use established
  signatures but confirm against the deployed contracts.
- **USYC is permissioned**: the vault must be allowlisted (Entitlements) via Circle support before
  mint/redeem works. Request early; use a mock USYC for the demo if allowlisting hasn't landed.
- **Decoders are the crown jewels**: any arg a decoder doesn't return is unconstrained. Run the
  `solidity-auditor` skill on `src/decoders/*` before any live funds.

> Scaffold for a hackathon — not audited. See "Known simplifications" in `ARCHITECTURE.md`.
> `BasisDecoderAndSanitizer.sol` and `strategists/BasisFarm.ts` are deprecated stubs (the perp
> cash-and-carry brain) kept only because the workspace couldn't delete them — remove when cloning.
