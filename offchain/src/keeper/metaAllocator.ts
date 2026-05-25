import { createWalletClient, createPublicClient, http, parseAbiItem, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDR, CHAIN, arcTestnet } from "../config";

const ALLOC_ABI = [
  parseAbiItem("function totalNav() view returns (uint256)"),
  parseAbiItem("function vaultNav(uint256) view returns (uint256)"),
  parseAbiItem("function previewSplit() view returns (uint16, uint16)"),
  parseAbiItem("function performance(uint256) view returns (uint256)"),
  parseAbiItem("function inBreaker(uint256) view returns (bool)"),
  parseAbiItem("function rollEpoch()"),
] as const;

/**
 * MetaAllocator keeper: prints the live scoreboard the judges watch, and (with ROLL=1) snapshots
 * a new scoring epoch so the winner-take-most tilt re-bases. Routing of fresh deposits happens
 * automatically inside deposit(); this loop is monitoring + epoch management.
 */
async function main() {
  const pc = createPublicClient({ chain: arcTestnet, transport: http(CHAIN.rpcUrl) });
  const a = ADDR.META_ALLOCATOR;

  const [nav, navA, navB, split, perfA, perfB, brkA, brkB] = await Promise.all([
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "totalNav" }),
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "vaultNav", args: [0n] }),
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "vaultNav", args: [1n] }),
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "previewSplit" }),
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "performance", args: [0n] }),
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "performance", args: [1n] }),
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "inBreaker", args: [0n] }),
    pc.readContract({ address: a, abi: ALLOC_ABI, functionName: "inBreaker", args: [1n] }),
  ]);

  const pct = (x: bigint) => `${(Number(x) / 1e18 - 1) * 100 >= 0 ? "+" : ""}${((Number(x) / 1e18 - 1) * 100).toFixed(2)}%`;
  console.table({
    totalNav_USDC: (Number(nav) / 1e6).toLocaleString(),
    RegimeShift_NAV: (Number(navA) / 1e6).toLocaleString(),
    CarryFarm_NAV: (Number(navB) / 1e6).toLocaleString(),
    RegimeShift_perf: pct(perfA),
    CarryFarm_perf: pct(perfB),
    nextSplit: `${Number(split[0]) / 100}% / ${Number(split[1]) / 100}%`,
    RegimeShift_breaker: brkA,
    CarryFarm_breaker: brkB,
  });

  if (process.env.ROLL === "1") {
    const pk = process.env.ALLOCATOR_PK as Hex;
    if (!pk) throw new Error("set ALLOCATOR_PK to roll the epoch");
    const wallet = createWalletClient({ account: privateKeyToAccount(pk), chain: arcTestnet, transport: http(CHAIN.rpcUrl) });
    const hash = await wallet.writeContract({ address: a, abi: ALLOC_ABI, functionName: "rollEpoch" });
    console.log("rolled epoch:", hash);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
