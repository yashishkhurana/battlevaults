// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {Auth, Authority} from "solmate/auth/Auth.sol";
import {BoringVault} from "./BoringVault.sol";
import {Accountant} from "./Accountant.sol";

/**
 * @title Teller (minimal)
 * @notice Deposit / withdraw entrypoint for a single vault. The MetaAllocator is the primary
 *         caller (it routes capital here), but it can also be opened to the public for a
 *         "back this AI directly" flow. Deposit events are the source of the AUM and
 *         number-of-users traction metrics.
 *
 *         Share math (scaffold-simple): rate = base asset per 1e18 shares.
 *           shares = assets * 1e18 / rate
 *           assets = shares * rate / 1e18
 */
contract Teller is Auth {
    using SafeTransferLib for ERC20;

    BoringVault public immutable vault;
    Accountant public immutable accountant;
    ERC20 public immutable base; // USDC

    uint256 internal constant WAD = 1e18;

    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, uint256 shares, uint256 assets);

    error Teller__MinNotMet();

    constructor(address _owner, address _vault, address _accountant, address _base)
        Auth(_owner, Authority(address(0)))
    {
        vault = BoringVault(payable(_vault));
        accountant = Accountant(_accountant);
        base = ERC20(_base);
    }

    function deposit(uint256 assets, uint256 minShares) external returns (uint256 shares) {
        shares = (assets * WAD) / accountant.getRate();
        if (shares < minShares) revert Teller__MinNotMet();
        // pull from caller (allocator/user), mint shares to caller
        vault.enter(msg.sender, base, assets, msg.sender, shares);
        emit Deposit(msg.sender, msg.sender, assets, shares);
    }

    function withdraw(uint256 shares, uint256 minAssets) external returns (uint256 assets) {
        assets = (shares * accountant.getRate()) / WAD;
        if (assets < minAssets) revert Teller__MinNotMet();
        vault.exit(msg.sender, base, assets, msg.sender, shares);
        emit Withdraw(msg.sender, shares, assets);
    }
}
