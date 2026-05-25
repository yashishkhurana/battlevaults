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
  USYC: "0x825Ae482558415310C71B7E03d2BbBe409345903" as Hex,
  // GO-LIVE GATE: confirm on arcscan whether deposit/redeem live on the token itself or a separate
  // Teller. Defaulted to the token address (token-as-teller); if arcscan shows a distinct Teller
  // contract, put it here and re-run `npm run build-tree`.
  USYC_TELLER: "0x825Ae482558415310C71B7E03d2BbBe409345903" as Hex,
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

  // --- deployed by script/Deploy.s.sol (fill after deploy) ---
  REGIME_VAULT: "0x0000000000000000000000000000000000000000" as Hex,
  REGIME_MANAGER: "0x0000000000000000000000000000000000000000" as Hex,
  REGIME_ACCOUNTANT: "0x0000000000000000000000000000000000000000" as Hex,
  REGIME_DECODER: "0x0000000000000000000000000000000000000000" as Hex,

  CARRY_VAULT: "0x0000000000000000000000000000000000000000" as Hex,
  CARRY_MANAGER: "0x0000000000000000000000000000000000000000" as Hex,
  CARRY_ACCOUNTANT: "0x0000000000000000000000000000000000000000" as Hex,
  CARRY_DECODER: "0x0000000000000000000000000000000000000000" as Hex,

  META_ALLOCATOR: "0x0000000000000000000000000000000000000000" as Hex,
  AGENT_JOURNAL: "0x0000000000000000000000000000000000000000" as Hex, // on-chain reasoning log

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
 * The agent uses the Anthropic API to make decisions when ANTHROPIC_API_KEY is set; otherwise it
 * falls back to the deterministic rule engine so the keeper always runs (e.g. offline demos).
 *   env: ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-sonnet-4-6), IPFS_BASE_URL (optional)
 */
export const LLM = {
  enabled: !!process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
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
