// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";

/**
 * @title MockUSYC + MockUSYCTeller  (TESTNET ONLY)
 * @notice Stand-in for USYC on Arc Testnet when the real token's Entitlements allowlist isn't
 *         available. The Teller implements the SAME ABI the decoders pin, so nothing else changes:
 *           deposit(uint256 assets, address receiver)                  -> mint USYC at `price`
 *           redeem(uint256 shares, address receiver, address account)  -> burn USYC, pay USDC
 *
 *         `price` is USDC per 1 USYC (6 decimals, starts at 1.000000). The owner can bump it to
 *         simulate accruing T-bill yield; fund the teller with extra USDC so redemptions at a
 *         higher price can be paid. NOT for production.
 */
contract MockUSYC is ERC20 {
    address public teller;

    constructor() ERC20("Mock USYC", "USYC", 6) {}

    function setTeller(address t) external {
        require(teller == address(0), "teller set");
        teller = t;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == teller, "only teller");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == teller, "only teller");
        _burn(from, amount);
    }
}

contract MockUSYCTeller {
    using SafeTransferLib for ERC20;

    ERC20 public immutable usdc;
    MockUSYC public immutable usyc;
    address public owner;
    uint256 public price = 1e6; // USDC per 1 USYC, 6dp

    constructor(address _usdc, address _usyc) {
        usdc = ERC20(_usdc);
        usyc = MockUSYC(_usyc);
        owner = msg.sender;
    }

    /// simulate yield accrual (price only goes up); fund the teller with USDC to cover it
    function setPrice(uint256 p) external {
        require(msg.sender == owner, "only owner");
        require(p >= 1e6, "no markdown");
        price = p;
    }

    /// subscribe: pull USDC from caller (the vault), mint USYC to receiver (the vault)
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        usdc.safeTransferFrom(msg.sender, address(this), assets);
        shares = (assets * 1e6) / price;
        usyc.mint(receiver, shares);
    }

    /// redeem: burn USYC from account, pay USDC to receiver
    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets) {
        usyc.burn(account, shares);
        assets = (shares * price) / 1e6;
        usdc.safeTransfer(receiver, assets);
    }

    /// owner pre-funds USDC so redemptions at price > 1 (yield) can be paid out
    function fund(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }
}
