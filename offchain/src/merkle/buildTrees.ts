import { writeFileSync } from "node:fs";
import { regimeActions, carryActions, buildActionTree } from "./bundles";

/**
 * Builds both agents' merkle roots and writes roots.json. Feed the roots into the deploy script
 * (REGIME_ROOT / CARRY_ROOT). Re-run whenever you add/remove an allowed action — the root
 * changes, and you must call manager.setManageRoot() with the new value.
 *
 * IMPORTANT: roots depend on the addresses in config.ts (decoders, vaults, USYC/CCTP/StableFX).
 * Fill the deployed addresses first, then build the trees, then set the roots.
 */
const regime = buildActionTree(regimeActions());
const carry = buildActionTree(carryActions());

const out = {
  regimeRoot: regime.tree.root,
  carryRoot: carry.tree.root,
  regimeLeafCount: regime.tree.leaves.length,
  carryLeafCount: carry.tree.leaves.length,
  generatedAt: new Date().toISOString(),
};

writeFileSync(new URL("../../roots.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("REGIME_ROOT=" + regime.tree.root);
console.log("CARRY_ROOT=" + carry.tree.root);
console.log("wrote offchain/roots.json");
