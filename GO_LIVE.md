# GO LIVE — 6-hour runbook

Do these in order. Each box is a gate. Commands assume `forge` on PATH and `cd` into the right dir.
Deeper rationale for each gate is in [`PRE_DEPLOY_CHECKLIST.md`](./PRE_DEPLOY_CHECKLIST.md).

> **Start the slow thing first:** Step 3 (USYC allowlist) is async (24–48h). Fire it in minute 1,
> then keep working — don't block on it.

---

## Step 0 — Green baseline (5 min)

- [ ] `cd contracts && forge test` → **12 passed** (4 BattleVaults + 8 Guardrail).
- [ ] `cd offchain && npm run typecheck` → exit 0.

If either fails, stop and fix before touching chain.

## Step 1 — Confirm the real ABIs on arcscan (20 min) — THE gate

Open each contract on [testnet.arcscan.app](https://testnet.arcscan.app) → Contract tab → Read/Write.
The merkle root commits to selectors and pinned addresses; if any is wrong, every live call reverts.

- [ ] **USYC** `0x825Ae4…5903` — does `deposit(uint256,address)` / `redeem(uint256,address,address)`
      live on THIS contract, or a separate Teller? 
      - If a separate Teller exists → set `ADDR.USYC_TELLER` to it in `offchain/src/config.ts`.
      - If the function names/args differ from the above → update both decoders
        (`src/decoders/RegimeDecoderAndSanitizer.sol`, `CarryDecoderAndSanitizer.sol`) AND
        `offchain/src/merkle/bundles.ts` (`SIG.usycDeposit` / `usycRedeem`) to match, keeping the
        recipient(s) pinned.
- [ ] **CCTP** `TokenMessengerV2 0x8FE6…2DAA` — confirm `depositForBurn` arg order matches
      `(uint256,uint32,bytes32,address,bytes32,uint256,uint32)`. If not, fix the decoder + `SIG.depositForBurn`.
- [ ] **StableFX** `FxEscrow 0x8676…a9f8` — confirm the settlement function. **Descope decision:** if the
      RFQ flow is non-trivial, drop the FX leg for v1 (remove `fx_*` from `carryActions`) and demo CarryFarm
      as USYC-only. Cleaner than a half-working swap.
- [ ] USDC `0x3600…0000` and EURC `0x89B5…D72a` — `decimals() == 6`; addresses match `config.ts`.

## Step 2 — Regenerate roots (2 min)

Only after Step 1 edits are final:

- [ ] `cd offchain && npm run build-tree` → copy `REGIME_ROOT` and `CARRY_ROOT`.
- [ ] `npm run typecheck` and `cd ../contracts && forge test` still green after any decoder edits.

## Step 3 — USYC allowlist (do at minute 1; may not land in 6h)

- [ ] Open a Circle Support ticket: allowlist BOTH vault addresses (you'll have them after Step 5) for
      USYC on Arc testnet. (You can request the deployer/owner now and add vaults when known.)
- [ ] **Descope decision:** if it won't clear in time, demo USYC as "wired, pending allowlist" and either
      deploy a mock USYC at `ADDR.USYC` for a live park/unpark, or route the demo through the CCTP leg
      (no allowlist needed). Don't let this block the deploy.

## Step 4 — Fund + env (10 min)

- [ ] Get testnet USDC for the deployer from [faucet.circle.com](https://faucet.circle.com) (gas is USDC on Arc).
- [ ] Generate 3 keys (or reuse): deployer/owner, strategist, oracle. **Never paste keys in chat.**
- [ ] Export env for the deploy:
```bash
export PRIVATE_KEY=0x...            # deployer/owner
export USDC=0x3600000000000000000000000000000000000000
export REGIME_STRATEGIST=0x...      # regime keeper EOA
export CARRY_STRATEGIST=0x...       # carry keeper EOA
export ORACLE=0x...                 # NAV pusher EOA
export REGIME_ROOT=0x...            # from Step 2
export CARRY_ROOT=0x...             # from Step 2
```

## Step 5 — Deploy on Arc (10 min)

- [ ] `cd contracts && forge install foundry-rs/forge-std transmissions11/solmate OpenZeppelin/openzeppelin-contracts@v5.1.0` (if `lib/` missing).
- [ ] Deploy:
```bash
forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```
- [ ] Record the printed addresses: authority, regime vault, carry vault, allocator, journal
      (the script logs them). Note each vault's Manager/Accountant/Decoder too.
- [ ] Verify the contracts on testnet.arcscan.app.

## Step 6 — Wire the deployed addresses (5 min)

- [ ] Fill `offchain/src/config.ts` with the deployed addresses: `REGIME_VAULT/MANAGER/ACCOUNTANT/DECODER`,
      `CARRY_VAULT/MANAGER/ACCOUNTANT/DECODER`, `META_ALLOCATOR`, `AGENT_JOURNAL`,
      `REMOTE_RISK_VAULT` (+ `REMOTE_CCTP_DOMAIN`) if demoing the bridge.
- [ ] **Roots depend on the vault addresses** (the USYC leaves pin `receiver = vault`), so finalize them now:
      `cd offchain && npm run build-tree` → copy the fresh `REGIME_ROOT` / `CARRY_ROOT`.
- [ ] Set them on-chain with the dedicated script (overwrites the placeholder roots Deploy set at Step 5):
```bash
export REGIME_MANAGER=0x... CARRY_MANAGER=0x... REGIME_ROOT=0x... CARRY_ROOT=0x...
# REGIME_STRATEGIST / CARRY_STRATEGIST / PRIVATE_KEY already exported
forge script script/SetRoots.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```

## Step 7 — Live smoke test (45 min)

- [ ] Deposit a small USDC amount into the MetaAllocator → confirm BATTLE minted, `totalNav()` moves.
- [ ] `cd offchain && npm run price` (dry) → sane AUM/rate; then `EXECUTE=1 ORACLE_PK=0x... npm run price` → rate pushed within bounds.
- [ ] `LLM_BASE_URL=http://your-deepseek:8000/v1 LLM_MODEL=deepseek-ai/DeepSeek-V3 EXECUTE=1 STRATEGIST_PK=0x... npm run regime` → a `manage` tx lands AND a `Deliberation` is recorded.
- [ ] Same for `carry`.
- [ ] **Re-prove the guardrail on the LIVE manager**: submit a deliberately wrong-recipient/wrong-domain
      call → it reverts. (Screenshot this for the video — it's your thesis.)
- [ ] Open `dashboard/index.html?allocator=0x…&journal=0x…&regime=0x…&carry=0x…` → live NAV / split /
      breaker / on-chain reasoning all populate.

## Step 8 — Submission + traction (remaining time)

- [ ] Push the repo (CI runs: `forge test` + `tsc`). Replace `OWNER/REPO` in the README badge.
- [ ] Onboard a few real testnet depositors (friends / teammates) — record the count; traction is 30%.
- [ ] Record the ≤3-min demo: the live dashboard, one keeper cycle with reasoning logged on-chain, and
      the guardrail revert.
- [ ] Submit the form with the live link, repo, video, and traction numbers.

---

### If you're short on time, ship this minimum

A deployed MetaAllocator + two vaults, the NAV pricer pushing rates, ONE keeper cycle per agent with a
journaled reasoning trace, the live dashboard, and the guardrail-revert shown on the live manager.
That alone demonstrates: autonomous decisions (agentic), on-chain reasoning (innovation), Circle stack
(USDC/USYC/CCTP), and bounded safety — the four things judged.
