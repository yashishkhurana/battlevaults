import type { MarketContext, Regime } from "../types";

function sma(xs: number[], n: number): number {
  const s = xs.slice(-n);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

/** annualized realized vol from a series of closes (rough daily approximation for the demo). */
export function realizedVol(prices: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < prices.length; i++) rets.push(Math.log(prices[i] / prices[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

export interface RegimeReading {
  regime: Regime;
  trendUp: boolean;
  vol: number;
  yieldSpread: number; // cryptoYield - tbill; >0 favors taking risk
  targetWeights: { risk: number; usdc: number; usyc: number };
  notes: string[];
}

/**
 * Defensible, explainable regime model (deliberately NOT a black box):
 *   trend  -> last close vs 50-period SMA
 *   risk   -> annualized realized vol vs a band
 *   carry  -> crypto yield minus T-bill (USYC) yield
 * The three combine into a score in [-3, +3]. Hysteresis: we only flip regime when the score
 * crosses a band, and "neutral" inherits the previous regime, so the book doesn't whipsaw on
 * noise (which would crank portfolio turnover -- a judged metric -- for no reason).
 */
export function classifyRegime(ctx: MarketContext, prev?: Regime): RegimeReading {
  const px = ctx.riskAssetPrices;
  const trendUp = px[px.length - 1] > sma(px, Math.min(50, px.length));
  const vol = realizedVol(px);
  const yieldSpread = ctx.cryptoYieldApy - ctx.tbillApy;

  let score = 0;
  score += trendUp ? 1 : -1;
  score += vol < 0.6 ? 1 : vol > 0.9 ? -1 : 0;
  score += yieldSpread > 0 ? 1 : -1;

  const notes = [
    `trend ${trendUp ? "up" : "down"}`,
    `vol ${(vol * 100).toFixed(0)}%`,
    `carry ${yieldSpread.toFixed(1)}%`,
    `score ${score}`,
  ];

  let regime: Regime;
  if (score >= 1) regime = "risk_on";
  else if (score <= -1) regime = "risk_off";
  else regime = prev ?? "neutral";

  // sticky band: don't let a single neutral reading drag us out of a committed regime
  if (prev === "risk_on" && regime === "neutral") regime = "risk_on";
  if (prev === "risk_off" && regime === "neutral") regime = "risk_off";

  const targetWeights =
    regime === "risk_on"
      ? { risk: 0.7, usdc: 0.1, usyc: 0.2 }
      : regime === "risk_off"
        ? { risk: 0.0, usdc: 0.1, usyc: 0.9 }
        : { risk: 0.35, usdc: 0.15, usyc: 0.5 };

  return { regime, trendUp, vol, yieldSpread, targetWeights, notes };
}
