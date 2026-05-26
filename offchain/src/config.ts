import { defineChain, type Hex } from "viem";

/**
 * Arc Testnet — Circle's stablecoin-native L1. USDC is the native gas token. EVM-compatible, so
 * Foundry/viem work unchanged. Source: docs.arc.io (connect-to-arc, contract-addresses).
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 }, // native gas uses 18 decimals
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

/**
 * Verified Arc Testnet addresses. NOTE: the USDC *ERC-20 interface* (what contracts approve/
 * transferFrom) uses **6 decimals**; the native gas balance uses 18. Always use the ERC-20
 * interface for transfers/reads (per Arc docs). There is **no DEX or perps on Arc testnet** —
 * the venues are USYC (yield), StableFX (USDC<->EURC FX), and CCTP/Gateway (cross-chain USDC).
 */
export const ADDR = {
  // --- stablecoins (Arc Testnet) ---
  USDC: "0x3600000000000000000000000000000000000000" as Hex, // ERC-20 interface, 6 decimals
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Hex, // 6 decimals

  // --- USYC: tokenized T-bill MMF (risk-off yield). Mint/redeem via the USYC Teller. ---
  // NOTE: USYC is permissioned — your vault address must be allowlisted (Entitlements) via Circle
  // support before mint/redeem works. For the demo, the merkle leaf pins the real Teller; execution
  // is gated on allowlisting (request early). Use a mock USYC if allowlisting hasn't landed.
  // USYC token on Arc Testnet — confirmed via arcscan (supersedes the 0xe918… the docs listed).
  USYC: "0xC8f0a1d3E0d8520DFAd5051592C12d05cc8F88C8" as Hex,
  // Mock USYC teller (no allowlist) — paired with MOCK_USYC above. Swap back to the real Teller
  // and rebuild roots once the vault is on the Entitlements allowlist.
  USYC_TELLER: "0xD8173fEC538ba368d93424D4424a2771C39d45AF" as Hex,
  USYC_ENTITLEMENTS: "0xcc205224862c7641930c87679e98999d23c26113" as Hex,

  // --- StableFX: RFQ FX engine for USDC<->EURC (the "FX diversification" venue). Needs Permit2. ---
  STABLEFX_ESCROW: "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8" as Hex,
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Hex,

  // --- CCTP v2 (domain 26): burn-and-mint USDC across chains (cross-chain rebalance leg) ---
  CCTP_TOKEN_MESSENGER: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Hex,
  CCTP_MESSAGE_TRANSMITTER: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Hex,
  CCTP_DOMAIN: 26,

  // --- Gateway (domain 26): unified, chain-abstracted USDC balance + sub-500ms transfers ---
  GATEWAY_WALLET: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Hex,
  GATEWAY_MINTER: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as Hex,

  MULTICALL3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Hex,

  // --- deployed by script/Deploy.s.sol (Arc Testnet, live) ---
  REGIME_VAULT: "0x158ae635F9E4558Bd80F82d1A30c66830B87FF85" as Hex,
  REGIME_MANAGER: "0x7449416482bae0fcdD6AAfEe07F1425e7937b56d" as Hex,
  REGIME_ACCOUNTANT: "0xa632d34E5fa0f7e1cf738fb4BF53B6bC1cF3059b" as Hex,
  REGIME_DECODER: "0x3f7D25102298C23208dbA3E399E512374493CA43" as Hex,

  CARRY_VAULT: "0x2828BBe00cC541514c7D3df6e0D6fCb886D4B0F3" as Hex,
  CARRY_MANAGER: "0x6Dcf84128028497A147469B8107ce295a43e45a6" as Hex,
  CARRY_ACCOUNTANT: "0xaB656159f64fE6FED0f89EaAE3aD71A81c574cB5" as Hex,
  CARRY_DECODER: "0x75ebA00B64ef34B3a6659e562fa954d3D799E6c9" as Hex,

  META_ALLOCATOR: "0xE82fdaf89F549333a96e50F9662155b7cbFA05Bb" as Hex,
  AGENT_JOURNAL: "0x538Fa4982022C37ac7Ba50fB741249297C6C2325" as Hex, // on-chain reasoning log

  // --- cross-chain "risk leg" lives on ANOTHER chain (no DEX/perps on Arc). The CCTP mintRecipient
  //     must be pinned to the sister vault on that chain. Fill when you wire the destination. ---
  REMOTE_RISK_VAULT: "0x0000000000000000000000000000000000000000" as Hex,
  REMOTE_CCTP_DOMAIN: 6, // e.g. Base = 6
} as const;

export const CHAIN = {
  // Canteen-hosted Arc testnet RPC is bundled in the ARC CLI; falls back to the public endpoint.
  rpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
};

/**
 * The agent calls an OpenAI-compatible chat endpoint (self-hosted DeepSeek via vLLM / Ollama /
 * SGLang / TGI, or DeepSeek cloud) when LLM_BASE_URL is set; otherwise it falls back to the
 * deterministic rule engine so the keeper always runs (e.g. offline demos).
 *   env: LLM_BASE_URL (e.g. http://localhost:8000/v1), LLM_MODEL (e.g. deepseek-ai/DeepSeek-V3),
 *        LLM_API_KEY (optional), IPFS_BASE_URL (optional)
 */
export const LLM = {
  enabled: !!process.env.LLM_BASE_URL,
  baseUrl: process.env.LLM_BASE_URL ?? "",
  model: process.env.LLM_MODEL ?? "deepseek-chat",
};

/**
 * Off-chain risk caps the strategists respect (size is not pinned by the merkle leaf — the leaf
 * pins which venue/asset/recipient).
 */
export const RISK_LIMITS = {
  maxUsycParkUsd: 1_000_000,
  maxFxSwapUsd: 250_000,
  maxBridgeUsd: 500_000,
};

export const MAX_UINT = (1n << 256n) - 1n;

/** USDC ERC-20 interface has 6 decimals on Arc. */
export function usdc(amount: number): bigint {
  return BigInt(Math.floor(amount * 1e6));
}
