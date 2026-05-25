import type { MarketContext } from "../types";

export interface FxReading {
  rotate: "into_eurc" | "hold_usyc" | "into_usdc";
  carryPct: number;
  notes: string[];
}

/**
 * CarryFarm's FX signal. Take an EURC sleeve only when EUR/USD carry clears a buffer over the
 * USYC T-bill floor; otherwise sit in USYC. Arc has no AMM, so EURC is acquired via StableFX RFQ.
 */
export function readFxCarry(ctx: MarketContext): FxReading {
  const carry = ctx.eurUsdCarryPct ?? 0;
  const buffer = 1.5; // % cushion over the T-bill floor for spread/fees
  const notes = [`eur/usd carry ${carry.toFixed(1)}%`, `tbill ${ctx.tbillApy}%`];
  if (carry > buffer) return { rotate: "into_eurc", carryPct: carry, notes };
  if (carry < -buffer) return { rotate: "into_usdc", carryPct: carry, notes };
  return { rotate: "hold_usyc", carryPct: carry, notes };
}
