import { classifyRegime } from "../signals/regime";
import type { ActionIntent, AgentDecision, MarketContext, Regime, Strategist } from "../types";

/**
 * RegimeShift rule engine — the deterministic fallback / prior for the LLM agent. Emits action
 * INTENTS (name + notional); the keeper turns those into merkle-bounded calls. Risk-off parks in
 * USYC; risk-on bridges USDC to the cross-chain risk vault via CCTP.
 */
export class RegimeShift implements Strategist {
  readonly name = "RegimeShift";
  private prev?: Regime;

  decide(ctx: MarketContext): AgentDecision {
    const r = classifyRegime(ctx, this.prev);
    this.prev = r.regime;
    const equity = ctx.equityUsd ?? 0;
    const intents: ActionIntent[] = [];

    if (r.regime === "risk_off") {
      intents.push({ actionName: "approve_usyc_teller", notionalUsd: 0 });
      intents.push({ actionName: "park_usyc", notionalUsd: equity * r.targetWeights.usyc });
    } else if (r.regime === "risk_on") {
      const deploy = equity * r.targetWeights.risk;
      intents.push({ actionName: "unpark_usyc", notionalUsd: deploy });
      intents.push({ actionName: "approve_cctp", notionalUsd: 0 });
      intents.push({ actionName: "bridge_risk_on", notionalUsd: deploy });
    }
    // neutral -> hold (no actions keeps turnover low)

    const w = r.targetWeights;
    const reasoning =
      `RegimeShift (rule): regime=${r.regime} [${r.notes.join(", ")}]. ` +
      `Target risk ${(w.risk * 100).toFixed(0)}% (cross-chain via CCTP) / USYC ${(w.usyc * 100).toFixed(0)}%. ` +
      (r.regime === "risk_off"
        ? "Parking in USYC T-bills."
        : r.regime === "risk_on"
          ? "Bridging USDC to the risk venue via CCTP."
          : "Holding inside the hysteresis band.");

    return { view: r.regime, confidence: scoreConfidence(r.notes), intents, reasoning, source: "fallback" };
  }
}

function scoreConfidence(notes: string[]): number {
  const s = notes.find((n) => n.startsWith("score "));
  const v = s ? Math.abs(parseInt(s.slice(6), 10)) : 1;
  return Math.min(1, 0.4 + v * 0.2);
}
