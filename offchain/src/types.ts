import type { Hex } from "viem";

export type Regime = "risk_on" | "neutral" | "risk_off";

/** One pre-approved action. Its leaf is committed into a strategist's merkle root. */
export interface Action {
  name: string;
  decoder: Hex;
  target: Hex;
  valueNonZero: boolean;
  /** human-readable signature, e.g. "approve(address,uint256)" */
  signature: string;
  /** sanitized addresses, in the exact order the on-chain decoder returns them */
  argAddresses: Hex[];
  /** extra non-address packed bytes the decoder appends after the addresses (e.g. a uint32
   *  destinationDomain for CCTP). Must match the decoder's abi.encodePacked tail byte-for-byte. */
  argExtraPacked?: Hex;
}

/** What an agent chooses: an allowed action name + the USD notional to size it. */
export interface ActionIntent {
  actionName: string;
  notionalUsd: number;
}

/**
 * An agent's decision for one cycle — the unit that gets BOTH executed (as merkle-bounded calls)
 * AND journaled on-chain (reasoning hashed + pinned). Produced by the LLM, or by the rule engine
 * as a deterministic fallback.
 */
export interface AgentDecision {
  view: string; // market view this cycle (regime label or FX state)
  confidence: number; // 0..1
  intents: ActionIntent[];
  reasoning: string; // natural-language trace; hashed + pinned on-chain
  source: "llm" | "fallback";
}

export interface MarketContext {
  riskAssetPrices: number[]; // recent closes, oldest -> newest
  tbillApy: number; // USYC yield, annualized %
  cryptoYieldApy: number; // yield available on the cross-chain risk venue, %
  eurUsdCarryPct?: number; // EUR/USD carry for CarryFarm's FX sleeve, annualized %
  equityUsd?: number; // vault equity the agent is sizing against
}

export interface Strategist {
  readonly name: string;
  /** deterministic rule-based decision; used as the LLM's fallback (and a strong prior). */
  decide(ctx: MarketContext): AgentDecision;
}
