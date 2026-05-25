import { keccak256, toHex, type Hex } from "viem";

/** keccak of the reasoning trace — recorded on-chain in the AgentJournal. */
export function rationaleHash(text: string): Hex {
  return keccak256(toHex(text));
}

/**
 * Pin the full reasoning trace off-chain and return a reference (the journal stores this CID
 * alongside the hash, so the text is retrievable and verifiable). Stubbed to a deterministic
 * pseudo-CID so the demo path has no hard dependency on a pinning provider; wire web3.storage /
 * Pinata / Irys here for production.
 */
export async function pinReasoning(text: string): Promise<string> {
  const fingerprint = rationaleHash(text).slice(2, 18);
  return process.env.IPFS_BASE_URL ? `${process.env.IPFS_BASE_URL}/${fingerprint}` : `ipfs-stub://${fingerprint}`;
}
