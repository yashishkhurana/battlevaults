# Battle Vaults — Demo Run-Sheet + 3-Minute Video Script

## 30-minute priority order

1. **(5m) Lock the required assets.** Push `feat/battle-vaults`, make the repo **public**, replace
   `OWNER/REPO` → `lucidlylabs/strats` in the README CI badge. Open the submission form.
2. **(5m) Pre-stage** the tabs + terminal (see Setup). Verify the guardrail revert + `npm run regime`
   (`source=llm`) both work — these are your two must-show moments and need no funding.
3. **(10m, optional) Live value-move:** wire mock USYC → fund the regime vault → `EXECUTE=1 npm run regime`
   + `npm run price`. Capture the arcscan tx links. **If anything snags, skip it** — the demo is strong without it.
4. **(10m) Record + submit.** Script below. Report traction honestly on the form.

## What's already provable on-chain (no funding/mock/allowlist needed)

- Deployed contracts on [testnet.arcscan.app](https://testnet.arcscan.app): vaults, managers, decoders, allocator, journal.
- The `SetRoots` tx (roots live on each manager).
- **Guardrail revert** — submit a non-whitelisted call to the manager → reverts at the merkle check.
- **LLM deciding** — `npm run regime` prints `source=llm` + the model's reasoning.
- Dashboard (live mode reads the allocator + journal; sim mode animates the race).

## Setup before recording

- Terminal in `offchain/` with `.env` loaded (free LLM live).
- Tab 1: `dashboard/index.html?allocator=0xE82f…05Bb&journal=0x538F…2325`
- Tab 2: arcscan → MetaAllocator. Tab 3: arcscan → AgentJournal (Deliberation events).
- Tab 4: GitHub repo (CI badge green).

## 3-Minute Video Script  (~450 words; ~150 wpm)

**[0:00–0:20 · Hook]** — SHOW: dashboard, NAV race animating.
> "The agora was where a civilization decided what things are worth. Markets still do that job — but
> they never sleep, and no human can watch every signal at once. So we made AI agents citizens of the
> agora. The hard part was never getting an AI to make a call — it's trusting it with the money. Here's
> how we solved that."

**[0:20–0:50 · What it is]** — SHOW: README / architecture.
> "Battle Vaults: two AI agents — RegimeShift and CarryFarm — each manage a vault on Arc, Circle's
> stablecoin L1. They read the market regime and allocate between risk, USYC T-bill yield, and
> cross-chain deployments. A meta-allocator routes capital to whichever agent is winning. Everything
> settles on Arc — gas paid in USDC, sub-second finality."

**[0:50–1:30 · The agent deciding — Agentic 30%]** — SHOW: terminal `npm run regime` → `source=llm`, reasoning; then arcscan Deliberation event.
> "This is the agent thinking — a live LLM, not a hardcoded rule. It reads trend, volatility, and the
> crypto-yield-versus-T-bill carry, decides risk-off, and parks ninety percent in USYC. Every
> decision's reasoning is hashed and written on-chain to an Agent Journal — so the agent's thinking is
> a permanent, verifiable record. Reasoning as the product."

**[1:30–2:10 · The wow — Innovation 20%]** — SHOW: terminal submit non-whitelisted call → revert; arcscan failed tx; then the approved call succeeds.
> "But you can't just trust an AI with funds — so we don't. Every action the agent can take is committed
> to a merkle root: its constitution. Watch — I'll make the agent try to move funds to an address it was
> never approved for. [revert] Rejected on-chain. The same call to the approved destination goes
> through. The AI can hallucinate, get prompt-injected, or be compromised, and it still cannot move a
> cent outside its bounds. That's what makes autonomous money management safe."

**[2:10–2:40 · Circle stack + live — Circle 20%]** — SHOW: dashboard live + arcscan contracts.
> "It's live on Arc testnet today. USDC as the settlement asset and the gas token. USYC for risk-off
> yield. CCTP wired for cross-chain rebalancing. The scoreboard reads straight from the contracts —
> real NAV, real allocations, real on-chain rebalances."

**[2:40–3:00 · Close + Traction 30%]** — SHOW: dashboard KPIs / repo.
> "In the event window we deployed the full system, onboarded [N] depositors, and the agents have made
> [M] bounded, journaled decisions on-chain. AI agents as citizens of the agora — deciding what things
> are worth, around the clock, bounded by code. Battle Vaults."

## Traction — report honestly on the form

State real numbers: contracts deployed live on Arc testnet; number of on-chain agent decisions
journaled; depositors (you + teammates); AUM. Frame: "shipped a working, autonomous, cryptographically
-bounded portfolio manager — live on Arc — within the event window."

## One-liner for the form

> Battle Vaults — two AI agents run competing vaults on Arc; a free LLM decides allocation from market
> regime, every decision's reasoning is journaled on-chain, and a merkle guardrail makes the autonomy
> safe (the agent literally cannot act outside its pre-approved set). USDC-settled, USYC yield, CCTP cross-chain.
