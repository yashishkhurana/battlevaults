import type { Action, AgentDecision, MarketContext } from "../types";
import { buildPrompt, type Persona } from "./prompt";

/**
 * OpenAI-compatible chat client — works with a self-hosted DeepSeek server (vLLM, Ollama, SGLang,
 * TGI) and with DeepSeek's cloud API, since they all expose `/v1/chat/completions`. The LLM is the
 * decision-maker: given the context, the quant signal, and the allowed action menu, it chooses
 * which actions to take, sizes them, and explains why. It is bounded twice — it can only pick from
 * the menu (validated here), and whatever it picks is re-checked against the on-chain merkle root.
 *
 * Enable by setting LLM_BASE_URL; if unset (or the call fails) we deterministically fall back to
 * the rule engine so the keeper always runs.
 *
 *   env:
 *     LLM_BASE_URL  e.g. http://localhost:8000/v1   (vLLM)   ·   http://localhost:11434/v1 (Ollama)
 *                   ·   https://api.deepseek.com/v1 (DeepSeek cloud)
 *     LLM_MODEL     e.g. deepseek-ai/DeepSeek-V3 (vLLM id) · deepseek-chat / deepseek-reasoner (cloud)
 *     LLM_API_KEY   optional; many local servers ignore it
 */
const BASE_URL = process.env.LLM_BASE_URL ?? "";
const MODEL = process.env.LLM_MODEL ?? "deepseek-chat";
const API_KEY = process.env.LLM_API_KEY ?? "not-needed";

export async function decideWithLLM(opts: {
  persona: Persona;
  ctx: MarketContext;
  signal: unknown;
  allowed: Action[];
  fallback: () => AgentDecision;
}): Promise<AgentDecision> {
  if (!BASE_URL) return opts.fallback();

  try {
    const { system, user } = buildPrompt(opts.persona, opts.ctx, opts.signal, opts.allowed);

    const body: Record<string, unknown> = {
      model: MODEL,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    // Strict JSON mode — honored by most OpenAI-compatible providers (Groq, OpenRouter, DeepSeek,
    // vLLM, recent Ollama). Some free models 400 on it; set LLM_JSON_MODE=off to drop it (the prompt
    // still demands raw JSON and the parser strips ``` fences either way).
    if (process.env.LLM_JSON_MODE !== "off") body.response_format = { type: "json_object" };

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`llm ${res.status} ${await res.text()}`);

    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    const text: string = (msg.content ?? "").trim();
    const json = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));

    // defense-in-depth: drop any action the model invented that isn't on the allowed menu
    const allowedNames = new Set(opts.allowed.map((a) => a.name));
    const intents = (Array.isArray(json.intents) ? json.intents : [])
      .filter((i: any) => i && allowedNames.has(i.actionName))
      .map((i: any) => ({ actionName: String(i.actionName), notionalUsd: Math.max(0, Number(i.notionalUsd) || 0) }));

    // reasoner models (deepseek-reasoner / R1) expose the chain-of-thought separately — capture it
    // as part of the journaled trace ("reasoning trace as the product").
    const cot = typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
    const reasoning = (String(json.reasoning ?? "") + (cot ? `\n\n[trace] ${cot}` : "")).slice(0, 4000);

    return {
      view: String(json.view ?? "neutral"),
      confidence: Math.min(1, Math.max(0, Number(json.confidence) || 0)),
      intents,
      reasoning,
      source: "llm",
    };
  } catch (e) {
    console.warn(`[LLM] falling back to rule engine: ${(e as Error).message}`);
    return opts.fallback();
  }
}
