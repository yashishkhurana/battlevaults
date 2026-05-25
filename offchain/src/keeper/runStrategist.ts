import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbiItem,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDR, CHAIN, arcTestnet } from "../config";
import { regimeActions, carryActions, buildActionTree } from "../merkle/bundles";
import { RegimeShift } from "../strategists/RegimeShift";
import { CarryFarm } from "../strategists/CarryFarm";
import { buildArgs } from "../strategists/actionArgs";
import { classifyRegime } from "../signals/regime";
import { readFxCarry } from "../signals/fx";
import { decideWithLLM } from "../llm/agent";
import { PERSONAS } from "../llm/prompt";
import { rationaleHash, pinReasoning } from "../llm/rationale";
import type { Action, MarketContext, Strategist } from "../types";

const MANAGER_ABI = [
  parseAbiItem(
    "function manageVaultWithMerkleVerification(bytes32[][] manageProofs, address[] decodersAndSanitizers, address[] targets, bytes[] targetData, uint256[] values)",
  ),
] as const;

const JOURNAL_ABI = [
  parseAbiItem("function record(bytes32 decisionHash, string viewTag, uint16 confidenceBps, string ipfsCid) returns (uint256)"),
] as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function encodeCall(signature: string, args: unknown[]): Hex {
  const item = parseAbiItem(`function ${signature}`);
  const functionName = signature.slice(0, signature.indexOf("("));
  return encodeFunctionData({ abi: [item], functionName, args } as never);
}

/**
 * STUB market data. Wire your real price feed + funding/FX APIs here.
 *
 * Defaults are tuned for a SAFE live run on Arc: regime resolves risk-off (park in USYC) and
 * CarryFarm holds USYC. So an EXECUTE cycle only touches the USYC teller — never the cross-chain
 * bridge (REMOTE_RISK_VAULT is unset -> would target 0x0) or StableFX (RFQ not implemented).
 * Flip cryptoYieldApy high / eurUsdCarryPct above ~1.5 (and set REMOTE_RISK_VAULT) to exercise
 * the risk-on / FX paths once those venues are wired.
 */
async function fetchMarketContext(): Promise<MarketContext> {
  return {
    riskAssetPrices: [3500, 3400, 3350, 3300, 3200, 3150, 3100, 3050, 3010, 2950],
    tbillApy: 5.0,
    cryptoYieldApy: 2.0, // below the T-bill floor -> negative carry -> RegimeShift risk-off (USYC)
    eurUsdCarryPct: 1.0, // inside the buffer -> CarryFarm holds USYC (no FX leg)
    equityUsd: 100_000,
  };
}

async function main() {
  const which = process.argv[2];
  if (which !== "regime" && which !== "carry") {
    throw new Error("usage: tsx src/keeper/runStrategist.ts <regime|carry>");
  }

  const rule: Strategist = which === "regime" ? new RegimeShift() : new CarryFarm();
  const actions: Action[] = which === "regime" ? regimeActions() : carryActions();
  const manager: Hex = which === "regime" ? ADDR.REGIME_MANAGER : ADDR.CARRY_MANAGER;
  const vault: Hex = which === "regime" ? ADDR.REGIME_VAULT : ADDR.CARRY_VAULT;
  const persona = which === "regime" ? PERSONAS.regime : PERSONAS.carry;
  const tree = buildActionTree(actions);

  const ctx = await fetchMarketContext();
  const signal = which === "regime" ? classifyRegime(ctx) : readFxCarry(ctx);

  // The LLM is the decision-maker; the rule engine is the deterministic fallback (no API key/err).
  const decision = await decideWithLLM({ persona, ctx, signal, allowed: actions, fallback: () => rule.decide(ctx) });

  console.log(`\n[${persona.name}] view=${decision.view} confidence=${(decision.confidence * 100).toFixed(0)}% source=${decision.source}`);
  console.log(`reasoning: ${decision.reasoning}`);
  const hash = rationaleHash(decision.reasoning);
  console.log(`reasoningHash: ${hash}`);

  // build merkle-bounded calls from the intents
  const proofs: Hex[][] = [];
  const decoders: Hex[] = [];
  const targets: Hex[] = [];
  const data: Hex[] = [];
  const values: bigint[] = [];
  for (const intent of decision.intents) {
    const action = tree.actionByName.get(intent.actionName);
    if (!action) {
      console.warn(`  skip unknown action "${intent.actionName}"`);
      continue;
    }
    proofs.push(tree.proofByName(intent.actionName));
    decoders.push(action.decoder);
    targets.push(action.target);
    data.push(encodeCall(action.signature, buildArgs(intent.actionName, intent.notionalUsd, ctx, vault)));
    values.push(0n);
  }

  console.log(`built ${data.length} merkle-bounded calls -> ${manager}`);
  decision.intents.forEach((i, idx) => console.log(`  ${idx}. ${i.actionName}  $${i.notionalUsd.toLocaleString()}`));

  if (process.env.EXECUTE !== "1") {
    console.log("DRY RUN (set EXECUTE=1 + STRATEGIST_PK to broadcast)");
    return;
  }

  const pk = process.env.STRATEGIST_PK as Hex;
  if (!pk) throw new Error("set STRATEGIST_PK to broadcast");
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(CHAIN.rpcUrl) });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(CHAIN.rpcUrl) });

  // 1) execute the merkle-bounded rebalance
  if (data.length > 0) {
    const tx = await wallet.writeContract({
      address: manager,
      abi: MANAGER_ABI,
      functionName: "manageVaultWithMerkleVerification",
      args: [proofs, decoders, targets, data, values],
    });
    console.log("manage tx:", tx);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  // 2) record the deliberation on-chain ("thinking out loud in the agora")
  if (ADDR.AGENT_JOURNAL !== ZERO_ADDR) {
    const cid = await pinReasoning(decision.reasoning);
    const jtx = await wallet.writeContract({
      address: ADDR.AGENT_JOURNAL,
      abi: JOURNAL_ABI,
      functionName: "record",
      args: [hash, decision.view, Math.round(decision.confidence * 10000), cid],
    });
    console.log("journal tx:", jtx, "cid:", cid);
    await publicClient.waitForTransactionReceipt({ hash: jtx });
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
