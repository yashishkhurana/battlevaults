# Pre-Deploy Checklist — Battle Vaults (Arc)

Gates that must clear **before** any deploy that controls real value. Ordered by dependency.
Boxes are gates, not suggestions — a `[ ]` left unchecked blocks the next stage.

## 0. Security gates (from the decoder audit)

- [x] **RESOLVED — pin CCTP `destinationDomain`.** Finding #1: `depositForBurn` previously let the agent
      bridge to the approved recipient on *any* chain. Fixed: the decoder now packs `destinationDomain`,
      the off-chain leaf mirrors it (`Action.argExtraPacked`), roots regenerated, and
      `test_cctp_wrong_domain_reverts` proves a wrong-domain bridge reverts. (Re-verify after the real
      CCTP `depositForBurn` ABI is confirmed on arcscan.)
- [ ] **StableFX `settle`** — confirm `FxEscrow` validates the signed quote (price + recipient). If not,
      pin a max-slippage scalar into `CarryDecoderAndSanitizer.settle` + the leaf.
- [x] **RESOLVED — USYC recipient pinning.** Real Teller ABI (Circle docs) is
      `deposit(uint256,address receiver)` / `redeem(uint256,address receiver,address account)`. The decoders
      now pin `receiver` (deposit) and `receiver`+`account` (redeem) to the vault; `test_usyc_deposit_wrong_receiver_reverts`
      proves minting USYC elsewhere reverts. (Re-confirm the Arc Teller matches this ABI on arcscan.)
- [ ] Re-run the **guardrail test** against the FINAL decoder/bundle set — non-whitelisted call still reverts.
- [ ] Human security review booked (this was an AI pass only; decoders are the crown jewels).

## 1. ABI / selector verification on arcscan (do this BEFORE building roots)

The merkle root commits to function selectors. A wrong selector → every real call reverts (or worse,
an unintended function is reachable). Verify each on [testnet.arcscan.app](https://testnet.arcscan.app):

- [ ] USYC Teller (`0x9fdF…105A`) — confirm the Arc Teller exposes `deposit(uint256,address)` /
      `redeem(uint256,address,address)` (Circle docs ABI the decoders now target) and that addresses match config.
- [ ] CCTP `TokenMessengerV2` (`0x8FE6…2DAA`) — `depositForBurn` selector + full arg order.
- [ ] StableFX `FxEscrow` (`0x8676…a9f8`) — settlement selector + arg order + Permit2 (`0x0000…8BA3`) flow.
- [ ] USDC ERC-20 (`0x3600…0000`) and EURC (`0x89B5…D72a`) — `decimals() == 6`; addresses match `config.ts`.
- [ ] Only **after** all selectors confirmed: `npm run build-tree` → `manager.setManageRoot(...)` for each agent.

## 2. USYC allowlist (lead time — start NOW)

- [ ] Open a Circle Support ticket requesting **Entitlements allowlisting** for BOTH vault addresses
      (RegimeShift + CarryFarm) on Arc testnet. Typically 24–48h.
- [ ] Until allowlisted, USYC mint/redeem reverts — either deploy a mock USYC Teller for the demo, or
      gate the `park_usyc`/`unpark_usyc` actions out of the active root.

## 3. Accountant bounds + NAV pricer

- [ ] `Accountant.allowedUpperBps / allowedLowerBps / minUpdateDelay` match the pricer's guard
      (`UPPER_BPS=1000`, `LOWER_BPS=2000`) and your intended update cadence.
- [ ] `MetaAllocator` params sane: `tiltBps`, `maxWeightBps`, `maxDrawdownBps (2000)`.
- [ ] Pricer price sources are REAL, not placeholders: USYC NAV/price source wired, EUR/USD feed wired,
      cross-chain in-flight tracked — and reconciled against your `aum.py` conventions + decimals.
- [ ] Oracle update cadence ≥ `minUpdateDelay`; pricer deviation-guard tested (won't push a pausing rate).

## 4. Access control + keys (no key in chat, ever)

- [ ] `owner` of RolesAuthority / vaults / managers / accountants = a **multisig**, not the deployer EOA.
- [ ] Strategist EOA = a dedicated hot key with ONLY `manager.manageVaultWithMerkleVerification` +
      `journal.record` capability — never the owner.
- [ ] Oracle key separate, ONLY `accountant.updateExchangeRate`.
- [ ] Confirm `SimpleRolesAuthority` grants the minimal capability set (audit the live wiring).
- [ ] Rotate any key that ever appeared in chat, CI logs, or `.env` committed by accident.

## 5. Deploy + verify

- [ ] Fund deployer with testnet USDC from [faucet.circle.com](https://faucet.circle.com) (gas is USDC on Arc).
- [ ] `PRIVATE_KEY=… forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast`
      (key in env only).
- [ ] Verify all contracts on testnet.arcscan.app (verified source = institutional signal).
- [ ] Paste deployed addresses into `offchain/src/config.ts` and the dashboard query params; set the CI badge `OWNER/REPO`.

## 6. Live smoke test (small size, testnet)

- [ ] Deposit a small USDC amount → BATTLE shares minted; `totalNav()` reflects it.
- [ ] `npm run price` (dry-run, then `EXECUTE=1`) → NAV updates within bounds.
- [ ] One keeper cycle `EXECUTE=1` → `manage` tx lands AND a `Deliberation` is recorded in the journal.
- [ ] Re-confirm on the LIVE manager: a non-whitelisted call reverts (`Manager__BadProof`).
- [ ] Dashboard live mode (`?allocator=…&journal=…`) shows real NAV / split / breaker / reasoning.

## Do-not-ship gates

- Unaudited beyond this AI pass — get a human review before real (non-testnet) funds.
- USYC is permissioned; StableFX RFQ quote-fetching is not yet implemented.
- This is a hackathon build; treat testnet as testnet.
