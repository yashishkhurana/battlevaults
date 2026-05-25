import { createPublicClient, createWalletClient, http, parseAbiItem, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ADDR, CHAIN, arcTestnet } from "../config";

/**
 * NAV pricer — the spine of the whole product.
 *
 * Mirrors the standard BoringVault / Lucidly `aum.py` convention (couldn't read your exact file —
 * github.com is blocked by org policy on this machine; align the marked spots with it):
 *   1. read every asset balance the vault holds            (balanceOf(vault))
 *   2. price each asset in the base/quote asset (USDC)      (oracle / rate provider / FX feed)
 *   3. AUM = Σ balance_i · price_i                          (in USDC, 6dp)
 *   4. rate = AUM · 1e18 / totalShares                      (Accountant convention: base per 1e18 shares)
 *   5. push Accountant.updateExchangeRate(rate)             (the oracle key signs)
 *
 * A deviation guard refuses to push a rate that would breach the Accountant's per-update bounds
 * (+10% / -20%), which would otherwise auto-PAUSE the vault — so a bad price feed can't brick it.
 *
 * Usage:  tsx src/keeper/pricer.ts            # dry-run, prints AUM + rate for both vaults
 *         EXECUTE=1 ORACLE_PK=0x... tsx src/keeper/pricer.ts   # push on-chain
 */

const ERC20 = [
  parseAbiItem("function balanceOf(address) view returns (uint256)"),
  parseAbiItem("function totalSupply() view returns (uint256)"),
] as const;

const ACCT = [
  parseAbiItem("function getRate() view returns (uint256)"),
  parseAbiItem("function updateExchangeRate(uint256)"),
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";
const WAD = 10n ** 18n;

// ALIGN WITH aum.py: prices in USDC. USDC=1; USYC ≈ 1 + accrued yield (read its NAV/price in prod);
// EURC priced at EUR/USD from an FX oracle. All three use 6 decimals on Arc.
const PRICES = {
  USDC: 1.0,
  USYC: Number(process.env.USYC_PRICE ?? 1.0),
  EURC: Number(process.env.EURUSD ?? 1.08),
};

// per-update bounds must match Accountant.allowedUpperBps / allowedLowerBps
const UPPER_BPS = 1000; // +10%
const LOWER_BPS = 2000; // -20%

interface VaultCfg {
  name: string;
  vault: Hex;
  accountant: Hex;
}
const VAULTS: VaultCfg[] = [
  { name: "RegimeShift", vault: ADDR.REGIME_VAULT, accountant: ADDR.REGIME_ACCOUNTANT },
  { name: "CarryFarm", vault: ADDR.CARRY_VAULT, accountant: ADDR.CARRY_ACCOUNTANT },
];

const toNum = (b: bigint) => Number(b); // safe for testnet sizes (< 2^53)

async function priceVault(pc: ReturnType<typeof createPublicClient>, v: VaultCfg) {
  const [usdcBal, usycBal, eurcBal, shares, curRate] = await Promise.all([
    pc.readContract({ address: ADDR.USDC, abi: ERC20, functionName: "balanceOf", args: [v.vault] }),
    pc.readContract({ address: ADDR.USYC, abi: ERC20, functionName: "balanceOf", args: [v.vault] }),
    pc.readContract({ address: ADDR.EURC, abi: ERC20, functionName: "balanceOf", args: [v.vault] }),
    pc.readContract({ address: v.vault, abi: ERC20, functionName: "totalSupply" }),
    pc.readContract({ address: v.accountant, abi: ACCT, functionName: "getRate" }),
  ]);

  // cross-chain USDC still in flight (bridged via CCTP, not yet on Arc). ALIGN WITH aum.py: ideally
  // derived from CCTP burn/mint attestation tracking; here it's an explicit input.
  const pendingXchainUsdc6 = Math.round(Number(process.env.PENDING_XCHAIN_USDC ?? 0) * 1e6);

  // balances are 6dp integers; multiplying by ~O(1) prices keeps 6dp units -> AUM in USDC (6dp)
  const aumUsdc6 = BigInt(
    Math.round(
      toNum(usdcBal) * PRICES.USDC + toNum(usycBal) * PRICES.USYC + toNum(eurcBal) * PRICES.EURC,
    ) + pendingXchainUsdc6,
  );

  const newRate = shares > 0n ? (aumUsdc6 * WAD) / shares : curRate;
  return { usdcBal, usycBal, eurcBal, shares, curRate, aumUsdc6, newRate, pendingXchainUsdc6 };
}

function withinBounds(curRate: bigint, newRate: bigint): boolean {
  if (curRate === 0n) return true;
  const upper = curRate + (curRate * BigInt(UPPER_BPS)) / 10_000n;
  const lower = curRate - (curRate * BigInt(LOWER_BPS)) / 10_000n;
  return newRate <= upper && newRate >= lower;
}

async function main() {
  const pc = createPublicClient({ chain: arcTestnet, transport: http(CHAIN.rpcUrl) });
  const execute = process.env.EXECUTE === "1";
  const oraclePk = process.env.ORACLE_PK as Hex | undefined;
  const wallet =
    execute && oraclePk
      ? createWalletClient({ account: privateKeyToAccount(oraclePk), chain: arcTestnet, transport: http(CHAIN.rpcUrl) })
      : undefined;

  for (const v of VAULTS) {
    if (v.vault === ZERO || v.accountant === ZERO) {
      console.log(`skip ${v.name} (address unset in config)`);
      continue;
    }
    const r = await priceVault(pc, v);
    const usd = (x: bigint) => "$" + (Number(x) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
    console.log(`\n${v.name}`);
    console.log(`  holdings  USDC ${usd(r.usdcBal)} · USYC ${usd(r.usycBal)} · EURC ${usd(r.eurcBal)}${r.pendingXchainUsdc6 ? ` · in-flight ${usd(BigInt(r.pendingXchainUsdc6))}` : ""}`);
    console.log(`  AUM       ${usd(r.aumUsdc6)}   shares ${(Number(r.shares) / 1e18).toFixed(4)}`);
    console.log(`  rate      ${Number(r.curRate) / 1e6} -> ${Number(r.newRate) / 1e6}`);

    const ok = withinBounds(r.curRate, r.newRate);
    if (!ok) {
      console.warn(`  ⚠ new rate breaches per-update bounds (+${UPPER_BPS / 100}% / -${LOWER_BPS / 100}%); refusing to push (would PAUSE the vault). Investigate the price feed.`);
      continue;
    }
    if (!execute) {
      console.log("  DRY RUN (set EXECUTE=1 + ORACLE_PK to push)");
      continue;
    }
    if (!wallet) throw new Error("set ORACLE_PK to push");
    try {
      const tx = await wallet.writeContract({ address: v.accountant, abi: ACCT, functionName: "updateExchangeRate", args: [r.newRate] });
      console.log(`  pushed rate, tx ${tx}`);
      await pc.waitForTransactionReceipt({ hash: tx });
    } catch (e) {
      console.warn(`  push failed (likely minUpdateDelay not elapsed): ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
