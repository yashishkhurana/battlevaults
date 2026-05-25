import type { Action, AgentDecision, MarketContext } from "../types";
import { buildPrompt, type Persona } from "./prompt";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

/**
 * The LLM is the actual decision-maker: given the market context, the quant signal, and the
 * agent's allowed action menu, it picks which actions to take, sizes them, and explains why.
 * It is bounded twice over — it can only choose from the menu (validated here), and whatever it
 * picks is still checked against the on-chain merkle root. If no ANTHROPIC_API_KEY is set, or the
 * call fails, we deterministically fall back to the rule engine so the keeper always runs.
 */
export async function decideWithLLM(opts: {
  persona: Persona;
  ctx: MarketContext;
  signal: unknown;
  allowed: Action[];
  fallback: () => AgentDecision;
}): Promise<AgentDecision> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return opts.fallback();

  try {
    const { system, user } = buildPrompt(opts.persona, opts.ctx, opts.signal, opts.allowed);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status} ${await res.text()}`);

    const data: any = await res.json();
    const text: string = (data?.content?.[0]?.text ?? "").trim();
    const json = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));

    // defense-in-depth: drop any action the model invented that isn't on the allowed menu
    const allowedNames = new Set(opts.allowed.map((a) => a.name));
    const intents = (Array.isArray(json.intents) ? json.intents : [])
      .filter((i: any) => i && allowedNames.has(i.actionName))
      .map((i: any) => ({ actionName: String(i.actionName), notionalUsd: Math.max(0, Number(i.notionalUsd) || 0) }));

    return {
      view: String(json.view ?? "neutral"),
      confidence: Math.min(1, Math.max(0, Number(json.confidence) || 0)),
      intents,
      reasoning: String(json.reasoning ?? "").slice(0, 2000),
      source: "llm",
    };
  } catch (e) {
    console.warn(`[LLM] falling back to rule engine: ${(e as Error).message}`);
    return opts.fallback();
  }
}
