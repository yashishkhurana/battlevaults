import { readFxCarry } from "../signals/fx";
import type { ActionIntent, AgentDecision, MarketContext, Strategist } from "../types";

/**
 * CarryFarm rule engine — the deterministic fallback / prior for the LLM agent. Holds a USYC
 * T-bill base and rotates a sleeve USDC<->EURC via StableFX when the FX carry clears the floor.
 */
export class CarryFarm implements Strategist {
  readonly name = "CarryFarm";

  decide(ctx: MarketContext): AgentDecision {
    const fx = readFxCarry(ctx);
    const equity = ctx.equityUsd ?? 0;

    const intents: ActionIntent[] = [
      { actionName: "approve_usyc_teller", notionalUsd: 0 },
      { actionName: "park_usyc", notionalUsd: equity * 0.8 },
    ];
    if (fx.rotate === "into_eurc") {
      intents.push({ actionName: "approve_permit2_usdc", notionalUsd: 0 });
      intents.push({ actionName: "fx_usdc_to_eurc", notionalUsd: equity * 0.2 });
    } else if (fx.rotate === "into_usdc") {
      intents.push({ actionName: "approve_permit2_eurc", notionalUsd: 0 });
      intents.push({ actionName: "fx_eurc_to_usdc", notionalUsd: equity * 0.2 });
    }

    const reasoning =
      `CarryFarm (rule): ${fx.notes.join(", ")} -> ${fx.rotate}. ` +
      (fx.rotate === "into_eurc"
        ? "USYC base + EURC sleeve via StableFX for FX carry / diversification."
        : fx.rotate === "into_usdc"
          ? "Unwinding the EURC sleeve to USDC; carry no longer clears the floor."
          : "Sitting in USYC; FX carry inside the buffer.");

    const confidence = Math.min(1, 0.5 + Math.abs(fx.carryPct) * 0.1);
    return { view: fx.rotate, confidence, intents, reasoning, source: "fallback" };
  }
}
