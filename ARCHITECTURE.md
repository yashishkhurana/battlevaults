# Battle Vaults — Architecture

> Two AI-run BoringVaults compete on the same capital base. Fresh deposits route to whichever
> vault's NAV is winning, behind one shared on-chain guardrail. The thesis judges should walk
> away with: **you don't trust the AI — you bound it cryptographically, and you let two of them
> fight for the leaderboard.**

## 1. The core idea

The hackathon's unanswered question is *"how do you let an AI manage real money?"* Our answer is
the **ManagerWithMerkleVerification**: each AI strategist is assigned a merkle root that describes
its entire allowed action set. The AI proposes calls + merkle proofs; anything not in the tree
reverts. The AI can be wrong about the market, hallucinate, or get prompt-injected — it still
cannot do anything the root doesn't permit.

Battle Vaults takes that one step further: run **two** AIs with **different strategies but the
same guardrail design**, and let a **MetaAllocator** route capital to the winner. It's leaderboard-
native (returns vs benchmark is literally the scoreboard), it's great demo theater, and it proves
the guardrail layer is strategy-agnostic — you can hot-swap brains without touching the vault.

## 2. Components

```
                    deposit USDC
  user ───────────────────────────────►  MetaAllocator (BATTLE share)
                                          │  previewSplit(): route to winner
                          ┌───────────────┴───────────────┐
                          ▼ wA%                            ▼ wB%
                    Teller A                          Teller B
                          │ enter()                        │ enter()
                    BoringVault A  (RegimeShift)     BoringVault B  (BasisFarm)
                          ▲ manage()                       ▲ manage()
                  Manager A (merkle)                Manager B (merkle)
                          ▲ proofs                         ▲ proofs
              ┌───────────┴──────────┐         ┌───────────┴──────────┐
        RegimeShift brain        Accountant A   BasisFarm brain    Accountant B
        (off-chain, signs)       (NAV + HWM)    (off-chain, signs) (NAV + HWM)
              │                                       │
        regime classifier                       funding reader
        (trend/vol/carry)                       (cash-and-carry)
```

| Contract | Role | Why it matters here |
|---|---|---|
| `BoringVault` | Holds assets, mints/burns shares, executes `manage()` calls | Strategy-agnostic; trusts the Manager, not the AI |
| `ManagerWithMerkleVerification` | Verifies every strategist call against a per-strategist merkle root | **The guardrail.** The whole "trust an AI" story lives here |
| `DecoderAndSanitizer` | Extracts the sensitive address args from each call | Pins *which* assets/markets/recipients are allowed |
| `Accountant` | Tracks exchange rate (NAV) within bounds + high-water mark | NAV = returns-vs-benchmark metric; bounds = anti-hallucination tripwire; HWM = breaker input |
| `Teller` | Deposit/withdraw entrypoint | `Deposit` events = AUM + #users metrics |
| `MetaAllocator` | Routes deposits to the winning vault, mints unified BATTLE share | The novel piece; the scoreboard data source |
| `SimpleRolesAuthority` | Capability wiring (caller→target→selector) | Trimmed stand-in for Veda's RolesAuthority |

## 3. The guardrail in detail (the part judges should poke at)

For every call a strategist wants to make, the Manager:

1. **staticcalls the DecoderAndSanitizer** with the strategist's exact calldata. The decoder has a
   function with the *same selector* as the target function; it decodes the args and returns the
   **sensitive addresses** (recipient, tokenIn/out, pool, perp market) via `abi.encodePacked`.
2. **rebuilds the leaf**:
   `leaf = keccak256(abi.encodePacked(decoder, target, value>0, selector, packedArgs))`
3. **verifies** the leaf is in that strategist's merkle root (OpenZeppelin commutative proof).

So the root doesn't just whitelist "you may call Uniswap" — it whitelists "you may call
`exactInputSingle` on *this* router, swapping *USDC↔WETH*, with recipient = *the vault itself*."
The AI cannot swap into an arbitrary token or send funds to an arbitrary address.

> **Leaf parity is load-bearing.** The hashing in `ManagerWithMerkleVerification._verifyCall`
> (Solidity) must stay byte-for-byte identical to `offchain/src/merkle/leaf.ts`. Note the Manager
> `abi.decode`s the decoder's return value back into raw bytes before hashing — that matches
> `packAddresses()` off-chain. If you change one side, change both, then regenerate roots.

> **Highest-severity bug class: under-sanitizing.** Any argument a decoder does *not* return is
> unconstrained. Forget to pin a bridge `recipient` and the "guardrail" has a hole the AI can walk
> funds through. Treat every decoder edit as a security change — run the `solidity-auditor` skill
> on `src/decoders/*`.

## 4. The two brains

**RegimeShift** (`offchain/src/strategists/RegimeShift.ts`) — a deliberately *explainable* regime
model, not a black box:
- **trend**: last close vs 50-period SMA
- **risk**: annualized realized vol vs a band
- **carry**: crypto yield − T-bill (USYC) yield
- combined into a score in [-3,+3] with **hysteresis** (neutral inherits the prior regime) so the
  book doesn't whipsaw and crank turnover.
- risk-on → ~70% WETH; risk-off → ~90% USYC (T-bill yield); each rebalance ships a logged rationale.

**BasisFarm** (`offchain/src/strategists/BasisFarm.ts`) — cash-and-carry:
- short the whitelisted perp against spot to harvest funding; park idle margin in USYC.
- only farms when annualized funding clears the T-bill floor + a cost buffer; otherwise sits in USYC.
- size bounded off-chain (`RISK_LIMITS`) **and** pinned to one market on-chain (the leaf).

Both brains emit `PlannedCall[]` (action name + args). The keeper (`runStrategist.ts`) encodes the
calldata, attaches the merkle proof, and submits one `manageVaultWithMerkleVerification` tx.

## 5. The MetaAllocator (the battle mechanic)

- `deposit(assets)` pulls USDC, computes `previewSplit()`, deposits into each Teller, mints BATTLE
  shares pro-rata to the combined NAV.
- `previewSplit()` is **winner-take-most**: base 50/50, tilt +`tiltBps` to the leader over the
  scoring epoch, capped at `maxWeightBps` (default 80/20).
- **Circuit breaker**: if a vault's `Accountant.drawdownBps()` exceeds `maxDrawdownBps` (default
  20%), it's routed **0%** — the blown-up AI gets cut off automatically. This is the on-chain answer
  to the prompt's "risk management" bullet.
- `rollEpoch()` (keeper) re-bases the scoring window so the tilt reflects recent, not all-time,
  performance.

> Extension: `rebalance()` to move *existing* capital between vaults (not just fresh deposits)
> requires teller withdraw → re-deposit with slippage handling; left documented, not implemented.

## 6. Traction metrics — free from the stack

| Judged metric | Where it comes from |
|---|---|
| Number of users | `Teller.Deposit` / `MetaAllocator.Deposited` unique senders |
| Assets under management | `MetaAllocator.totalNav()` |
| Returns vs benchmark | per-vault `Accountant` rate vs BTC/S&P (charted in the dashboard) |
| Portfolio turnover / rebalance frequency | `Manager.StrategistManaged` event count |

## 7. Trust & safety summary (your slide)

1. **Merkle-bounded execution** — AI can only make pre-approved, pre-sanitized calls.
2. **Accountant rate bounds** — a hallucinated NAV jump auto-pauses the vault.
3. **Drawdown circuit breaker** — a losing AI is routed to 0% and (extension) collapsed to
   exit-to-USYC-only.
4. **Explainability** — every rebalance logs a human-readable rationale + a hash (IPFS-pinnable).
5. **Two brains, one guardrail** — proves the safety layer is strategy-agnostic.

## 8. Known simplifications (be honest in the demo)

- Share/decimal math is scaffold-simple (rate = base per 1e18 share; BATTLE minted NAV-pro-rata).
- Decoders mirror representative venue ABIs (Uniswap V3 router, a generic perps router) — swap in
  the real venue ABIs you deploy against.
- `SimpleRolesAuthority` is a trimmed capability map vs Veda's role-bitmap `RolesAuthority`.
- The dashboard runs a market simulation so the race moves without a deployment; `connectLive()`
  is the hook to read the real MetaAllocator.
- Real basis trading needs collateral-health monitoring and funding settlement accounting beyond
  this scaffold.
