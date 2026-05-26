// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {Auth, Authority} from "solmate/auth/Auth.sol";
import {Accountant} from "./Accountant.sol";
import {Teller} from "./Teller.sol";

/**
 * @title MetaAllocator  ("Battle Vaults")
 * @notice Two AI-run BoringVaults compete on the same capital base. Users deposit USDC HERE and
 *         receive a single BATTLE share representing a claim on the combined NAV. The allocator
 *         routes fresh capital toward whichever vault's NAV is winning over the current scoring
 *         epoch, and a global drawdown circuit-breaker cuts a blown-up vault to 0%.
 *
 *         Why this is the demo: every number on the judges' scoreboard (per-vault NAV, the
 *         capital split, total AUM, returns vs benchmark) is read straight off this contract and
 *         the two Accountants. The "back the winning AI" UX is just `deposit()`.
 *
 *         NOTE (scaffold): routing is winner-take-most with a hard cap; sharpen `tiltBps` for a
 *         punchier demo. `rebalance()` moving *existing* capital between vaults is left as a
 *         documented extension (requires teller withdraw + re-deposit and slippage handling).
 */
contract MetaAllocator is ERC20, Auth {
    using SafeTransferLib for ERC20;

    struct VaultInfo {
        Teller teller;
        Accountant accountant;
        ERC20 shareToken; // the vault's own ERC20 share (BoringVault is an ERC20)
    }

    ERC20 public immutable base; // USDC
    VaultInfo[2] public vaults;

    // scoring epoch
    uint256[2] public epochStartRate;
    uint64 public epochStart;

    // routing params (bps)
    uint16 public tiltBps = 3000; // winner gets 50% + 30% = 80%
    uint16 public maxWeightBps = 8000; // never route >80% to one vault
    uint16 public maxDrawdownBps = 2000; // a vault >20% below its HWM is cut to 0%

    event Deposited(address indexed user, uint256 assets, uint256 shares, uint16 wA, uint16 wB);
    event Redeemed(address indexed user, uint256 shares, uint256 assets);
    event EpochRolled(uint256 rateA, uint256 rateB, uint64 ts);
    event ParamsUpdated(uint16 tiltBps, uint16 maxWeightBps, uint16 maxDrawdownBps);

    error MetaAllocator__Zero();
    error MetaAllocator__MinNotMet();

    constructor(address _owner, address _base, VaultInfo[2] memory _vaults)
        ERC20("Battle Vaults Share", "BATTLE", 18)
        Auth(_owner, Authority(address(0)))
    {
        base = ERC20(_base);
        vaults[0] = _vaults[0];
        vaults[1] = _vaults[1];
        epochStartRate[0] = _vaults[0].accountant.getRate();
        epochStartRate[1] = _vaults[1].accountant.getRate();
        epochStart = uint64(block.timestamp);
    }

    // --------------------------------------------------------------------- //
    //                              Scoreboard views                         //
    // --------------------------------------------------------------------- //

    /// @notice NAV the allocator holds in vault `i`, in base asset (USDC) units.
    function vaultNav(uint256 i) public view returns (uint256) {
        VaultInfo storage v = vaults[i];
        uint256 shares = v.shareToken.balanceOf(address(this));
        return (shares * v.accountant.getRate()) / 1e18;
    }

    /// @notice combined NAV across both vaults plus any idle USDC.
    function totalNav() public view returns (uint256) {
        return vaultNav(0) + vaultNav(1) + base.balanceOf(address(this));
    }

    /// @notice growth factor of vault `i` since epoch start; 1e18 == flat.
    function performance(uint256 i) public view returns (uint256) {
        uint256 start = epochStartRate[i];
        if (start == 0) return 1e18;
        return (vaults[i].accountant.getRate() * 1e18) / start;
    }

    function inBreaker(uint256 i) public view returns (bool) {
        return vaults[i].accountant.drawdownBps() > maxDrawdownBps;
    }

    /// @notice routing split for fresh deposits in bps; wA + wB == 10000.
    function previewSplit() public view returns (uint16 wA, uint16 wB) {
        bool brkA = inBreaker(0);
        bool brkB = inBreaker(1);
        if (brkA && !brkB) return (0, 10_000);
        if (brkB && !brkA) return (10_000, 0);
        if (brkA && brkB) return (5_000, 5_000); // both blown -> neutral, capital mostly idles

        uint16 w = 5_000 + tiltBps;
        if (w > maxWeightBps) w = maxWeightBps;
        if (performance(0) >= performance(1)) return (w, 10_000 - w);
        return (10_000 - w, w);
    }

    // --------------------------------------------------------------------- //
    //                                 Deposit                               //
    // --------------------------------------------------------------------- //

    function deposit(uint256 assets, uint256 minShares) external returns (uint256 shares) {
        if (assets == 0) revert MetaAllocator__Zero();

        uint256 navBefore = totalNav();
        uint256 supply = totalSupply;

        base.safeTransferFrom(msg.sender, address(this), assets);

        (uint16 wA, uint16 wB) = previewSplit();
        uint256 toA = (assets * wA) / 10_000;
        uint256 toB = assets - toA;

        // NOTE: the BoringVault (not the Teller) executes the transferFrom inside enter(), so the
        // allocator must approve the VAULT (== shareToken address), not the teller.
        if (toA > 0) {
            base.safeApprove(address(vaults[0].shareToken), toA);
            vaults[0].teller.deposit(toA, 0);
        }
        if (toB > 0) {
            base.safeApprove(address(vaults[1].shareToken), toB);
            vaults[1].teller.deposit(toB, 0);
        }

        // BATTLE shares are minted pro-rata to NAV contributed.
        if (supply == 0 || navBefore == 0) {
            shares = assets; // 1:1 at inception
        } else {
            shares = (assets * supply) / navBefore;
        }
        if (shares < minShares) revert MetaAllocator__MinNotMet();
        _mint(msg.sender, shares);

        emit Deposited(msg.sender, assets, shares, wA, wB);
    }

    /**
     * @notice Burn BATTLE shares and withdraw a pro-rata slice of the underlying back to USDC.
     *         Pulls each vault's shares out through its Teller (which returns USDC), plus a
     *         proportional cut of any idle USDC. NOTE: requires the vaults to hold liquid USDC — if
     *         the agent has parked it in USYC, an agent unpark (redeem USYC) must run first.
     */
    function redeem(uint256 shares, uint256 minAssets) external returns (uint256 assets) {
        if (shares == 0) revert MetaAllocator__Zero();
        uint256 supply = totalSupply;
        _burn(msg.sender, shares);

        // proportional cut of any idle USDC the allocator holds
        assets = (base.balanceOf(address(this)) * shares) / supply;

        // proportional withdrawal of each vault's shares -> USDC back to the allocator
        for (uint256 i; i < 2; ++i) {
            VaultInfo storage v = vaults[i];
            uint256 take = (v.shareToken.balanceOf(address(this)) * shares) / supply;
            if (take > 0) assets += v.teller.withdraw(take, 0);
        }

        if (assets < minAssets) revert MetaAllocator__MinNotMet();
        base.safeTransfer(msg.sender, assets);
        emit Redeemed(msg.sender, shares, assets);
    }

    // --------------------------------------------------------------------- //
    //                           Keeper / governance                        //
    // --------------------------------------------------------------------- //

    /// @notice snapshot the scoring baseline. The MetaAllocator keeper calls this each epoch.
    function rollEpoch() external requiresAuth {
        epochStartRate[0] = vaults[0].accountant.getRate();
        epochStartRate[1] = vaults[1].accountant.getRate();
        epochStart = uint64(block.timestamp);
        emit EpochRolled(epochStartRate[0], epochStartRate[1], epochStart);
    }

    function setParams(uint16 _tiltBps, uint16 _maxWeightBps, uint16 _maxDrawdownBps) external requiresAuth {
        require(_tiltBps <= 5_000 && _maxWeightBps <= 10_000 && _maxWeightBps >= 5_000, "bad params");
        tiltBps = _tiltBps;
        maxWeightBps = _maxWeightBps;
        maxDrawdownBps = _maxDrawdownBps;
        emit ParamsUpdated(_tiltBps, _maxWeightBps, _maxDrawdownBps);
    }
}
