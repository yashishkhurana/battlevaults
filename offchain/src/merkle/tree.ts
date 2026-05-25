import { keccak256, concat, type Hex } from "viem";

/**
 * Commutative (sorted-pair) hashing, matching OpenZeppelin's MerkleProof.verify used by the
 * Manager. Sibling pairs are sorted before hashing so proofs need no left/right flags.
 */
function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([lo, hi]));
}

export interface MerkleTree {
  root: Hex;
  leaves: Hex[];
  proof(leaf: Hex): Hex[];
}

/** Build a merkle tree; lone (odd) nodes are promoted to the next layer. */
export function buildMerkleTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error("buildMerkleTree: no leaves");

  const layers: Hex[][] = [[...leaves]];
  let layer = layers[0];
  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 === layer.length) next.push(layer[i]); // promote odd node
      else next.push(hashPair(layer[i], layer[i + 1]));
    }
    layers.push(next);
    layer = next;
  }

  function proof(leaf: Hex): Hex[] {
    let idx = layers[0].findIndex((l) => l.toLowerCase() === leaf.toLowerCase());
    if (idx === -1) throw new Error("proof: leaf not in tree");
    const p: Hex[] = [];
    for (let level = 0; level < layers.length - 1; level++) {
      const lvl = layers[level];
      const sibling = idx % 2 === 1 ? idx - 1 : idx + 1;
      if (sibling < lvl.length) p.push(lvl[sibling]);
      idx = Math.floor(idx / 2);
    }
    return p;
  }

  return { root: layer[0], leaves, proof };
}
