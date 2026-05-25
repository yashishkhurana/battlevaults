import type { Action, MarketContext } from "../types";

export interface Persona {
  key: "regime" | "carry";
  name: string;
  mandate: string;
}

export const PERSONAS: Record<"regime" | "carry", Persona> = {
  regime: {
    key: "regime",
    name: "RegimeShift",
    mandate:
      "Detect the market regime (risk_on / neutral / risk_off) from trend, volatility, and the " +
      "crypto-yield-vs-T-bill carry. risk_off: park in USYC T-bills. risk_on: bridge USDC to the " +
      "cross-chain risk venue via CCTP. Avoid whipsaw — prefer holding (no actions) when the signal " +
      "is ambiguous, since needless turnover is penalized.",
  },
  carry: {
    key: "carry",
    name: "CarryFarm",
    mandate:
      "Hold a USYC T-bill base and rotate a sleeve USDC<->EURC via StableFX only when the EUR/USD " +
      "carry clearly beats the T-bill floor. Prioritize capital preservation and steady carry over swings.",
  },
};

/**
 * Builds the system + user prompt. The model is told it may ONLY pick from the allowed action
 * menu by exact name — anything off-menu is rejected by the on-chain merkle guardrail, so it is
 * wasted. The quant signal is provided as a strong prior, not a command.
 */
export function buildPrompt(p: Persona, ctx: MarketContext, signal: unknown, allowed: Action[]) {
  const menu = allowed.map((a) => `- ${a.name}`).join("\n");
  const system =
    `You are ${p.name}, an autonomous portfolio agent managing a vault on Arc (USDC-settled, sub-second finality). ${p.mandate}\n\n` +
    `HARD CONSTRAINTS:\n` +
    `- Choose actions ONLY from the allowed menu, by exact name, and set a USD notional for each.\n` +
    `- You CANNOT invent actions, targets, or assets — an on-chain merkle guardrail rejects anything off-menu.\n` +
    `- Approvals (approve_*) use notional 0. Prefer the smallest coherent set; choose no actions if holding is best.\n\n` +
    `Respond with ONLY a JSON object (no markdown fences, no prose) of the form:\n` +
    `{"view":"risk_on|neutral|risk_off","confidence":0.0-1.0,"intents":[{"actionName":"<name>","notionalUsd":<number>}],"reasoning":"<2-4 sentences on WHY>"}`;
  const user =
    `Market context: ${JSON.stringify(ctx)}\n` +
    `Quant signal (a strong prior, not a command): ${JSON.stringify(signal)}\n` +
    `Vault equity (USD): ${ctx.equityUsd ?? 0}\n\n` +
    `Allowed actions:\n${menu}\n\n` +
    `Decide for this cycle.`;
  return { system, user };
}
