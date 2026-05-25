import { toFunctionSelector, encodePacked, concat, type Hex } from "viem";
import { ADDR } from "../config";
import { makeLeaf, packAddresses } from "./leaf";
import { buildMerkleTree, type MerkleTree } from "./tree";
import type { Action } from "../types";

function sel(sig: string): Hex {
  return toFunctionSelector(`function ${sig}`);
}

const SIG = {
  approve: "approve(address,uint256)",
  // USYC Teller (Circle docs): deposit subscribes, redeem redeems
  usycDeposit: "deposit(uint256,address)",
  usycRedeem: "redeem(uint256,address,address)",
  // CCTP v2 TokenMessenger.depositForBurn
  depositForBurn: "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
  // StableFX RFQ settlement (representative; verify FxEscrow ABI on arcscan)
  settle: "settle(address,address,uint256,uint256,bytes)",
};

/**
 * RegimeShift's allowed action set on Arc:
 *   USYC park/unpark (risk-off) + bridge USDC to the sister risk vault via CCTP (risk-on).
 */
export function regimeActions(): Action[] {
  const d = ADDR.REGIME_DECODER;
  const v = ADDR.REGIME_VAULT;
  return [
    { name: "approve_usyc_teller", decoder: d, target: ADDR.USDC, valueNonZero: false, signature: SIG.approve, argAddresses: [ADDR.USYC_TELLER] },
    // deposit(assets, receiver=vault) / redeem(shares, receiver=vault, account=vault) -- recipients pinned
    { name: "park_usyc", decoder: d, target: ADDR.USYC_TELLER, valueNonZero: false, signature: SIG.usycDeposit, argAddresses: [v] },
    { name: "unpark_usyc", decoder: d, target: ADDR.USYC_TELLER, valueNonZero: false, signature: SIG.usycRedeem, argAddresses: [v, v] },
    { name: "approve_cctp", decoder: d, target: ADDR.USDC, valueNonZero: false, signature: SIG.approve, argAddresses: [ADDR.CCTP_TOKEN_MESSENGER] },
    // depositForBurn decoder pins [burnToken, mintRecipient, destinationDomain]; keeper must set
    // mintRecipient = pad32(REMOTE_RISK_VAULT) and destinationDomain = REMOTE_CCTP_DOMAIN.
    {
      name: "bridge_risk_on",
      decoder: d,
      target: ADDR.CCTP_TOKEN_MESSENGER,
      valueNonZero: false,
      signature: SIG.depositForBurn,
      argAddresses: [ADDR.USDC, ADDR.REMOTE_RISK_VAULT],
      argExtraPacked: encodePacked(["uint32"], [ADDR.REMOTE_CCTP_DOMAIN]),
    },
  ];
}

/**
 * CarryFarm's allowed action set on Arc:
 *   USYC park/unpark (yield base) + rotate a USDC<->EURC sleeve via StableFX (FX carry).
 */
export function carryActions(): Action[] {
  const d = ADDR.CARRY_DECODER;
  const v = ADDR.CARRY_VAULT;
  return [
    { name: "approve_usyc_teller", decoder: d, target: ADDR.USDC, valueNonZero: false, signature: SIG.approve, argAddresses: [ADDR.USYC_TELLER] },
    // deposit(assets, receiver=vault) / redeem(shares, receiver=vault, account=vault) -- recipients pinned
    { name: "park_usyc", decoder: d, target: ADDR.USYC_TELLER, valueNonZero: false, signature: SIG.usycDeposit, argAddresses: [v] },
    { name: "unpark_usyc", decoder: d, target: ADDR.USYC_TELLER, valueNonZero: false, signature: SIG.usycRedeem, argAddresses: [v, v] },
    { name: "approve_permit2_usdc", decoder: d, target: ADDR.USDC, valueNonZero: false, signature: SIG.approve, argAddresses: [ADDR.PERMIT2] },
    { name: "approve_permit2_eurc", decoder: d, target: ADDR.EURC, valueNonZero: false, signature: SIG.approve, argAddresses: [ADDR.PERMIT2] },
    { name: "fx_usdc_to_eurc", decoder: d, target: ADDR.STABLEFX_ESCROW, valueNonZero: false, signature: SIG.settle, argAddresses: [ADDR.USDC, ADDR.EURC] },
    { name: "fx_eurc_to_usdc", decoder: d, target: ADDR.STABLEFX_ESCROW, valueNonZero: false, signature: SIG.settle, argAddresses: [ADDR.EURC, ADDR.USDC] },
  ];
}

export interface ActionTree {
  tree: MerkleTree;
  actionByName: Map<string, Action>;
  proofByName(name: string): Hex[];
}

export function buildActionTree(actions: Action[]): ActionTree {
  const leaves: Hex[] = [];
  const leafByName = new Map<string, Hex>();
  const actionByName = new Map<string, Action>();

  for (const a of actions) {
    const addrPart = packAddresses(a.argAddresses);
    const packedArgs = a.argExtraPacked ? concat([addrPart, a.argExtraPacked]) : addrPart;
    const leaf = makeLeaf({
      decoder: a.decoder,
      target: a.target,
      valueNonZero: a.valueNonZero,
      selector: sel(a.signature),
      packedArgs,
    });
    leaves.push(leaf);
    leafByName.set(a.name, leaf);
    actionByName.set(a.name, a);
  }

  const tree = buildMerkleTree(leaves);
  return {
    tree,
    actionByName,
    proofByName(name: string): Hex[] {
      const leaf = leafByName.get(name);
      if (!leaf) throw new Error(`buildActionTree: no action "${name}"`);
      return tree.proof(leaf);
    },
  };
}
