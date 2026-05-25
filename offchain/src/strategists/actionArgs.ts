import { pad, type Hex } from "viem";
import { ADDR, MAX_UINT, usdc } from "../config";
import type { MarketContext } from "../types";

const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as Hex;

/**
 * Builds the abi args for a given allowed-action name + USD sizing. This is the ONLY place
 * calldata shape is constructed, which is what lets the LLM agent choose actions purely by NAME:
 * it can never specify a raw target/recipient, so even a hallucinated action name just fails the
 * lookup here, and anything that slips through still hits the on-chain merkle guardrail.
 */
export function buildArgs(actionName: string, notionalUsd: number, _ctx: MarketContext, vault: Hex): unknown[] {
  const amt = usdc(Math.max(0, notionalUsd));
  switch (actionName) {
    // approvals (notional ignored — we set/refresh the allowance)
    case "approve_usyc_teller":
      return [ADDR.USYC_TELLER, MAX_UINT];
    case "approve_cctp":
      return [ADDR.CCTP_TOKEN_MESSENGER, MAX_UINT];
    case "approve_permit2_usdc":
    case "approve_permit2_eurc":
      return [ADDR.PERMIT2, MAX_UINT];

    // USYC park / unpark (receivers pinned to the vault)
    case "park_usyc":
      return [amt, vault]; // deposit(assets, receiver)
    case "unpark_usyc":
      return [amt, vault, vault]; // redeem(shares, receiver, account)

    // CCTP v2 depositForBurn(amount, destDomain, mintRecipient, burnToken, destCaller, maxFee, minFinality)
    case "bridge_risk_on":
      return [amt, ADDR.REMOTE_CCTP_DOMAIN, pad(ADDR.REMOTE_RISK_VAULT, { size: 32 }), ADDR.USDC, ZERO_BYTES32, 0n, 1000];

    // StableFX settle(tokenIn, tokenOut, amountIn, minOut, quote) — quote fetched from RFQ off-chain
    case "fx_usdc_to_eurc":
      return [ADDR.USDC, ADDR.EURC, amt, 0n, "0x"];
    case "fx_eurc_to_usdc":
      return [ADDR.EURC, ADDR.USDC, amt, 0n, "0x"];

    default:
      throw new Error(`buildArgs: unknown action "${actionName}"`);
  }
}
