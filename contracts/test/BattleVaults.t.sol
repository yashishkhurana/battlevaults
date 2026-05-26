// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {Authority} from "solmate/auth/Auth.sol";
import {BoringVault} from "../src/BoringVault.sol";
import {Accountant} from "../src/Accountant.sol";
import {Teller} from "../src/Teller.sol";
import {MetaAllocator} from "../src/MetaAllocator.sol";
import {SimpleRolesAuthority} from "../src/SimpleRolesAuthority.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC", 6) {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/**
 * @notice Exercises the Battle Vaults wiring: deposit routing, the winner-take-most tilt, and the
 *         drawdown circuit-breaker. The merkle/manage execution path is covered by the off-chain
 *         leaf-parity script (offchain/src/merkle) and a fork test is left as a TODO.
 *
 *   forge test -vvv
 */
contract BattleVaultsTest is Test {
    MockUSDC usdc;
    SimpleRolesAuthority auth;

    BoringVault vaultA;
    BoringVault vaultB;
    Accountant accA;
    Accountant accB;
    Teller tellerA;
    Teller tellerB;
    MetaAllocator allocator;

    address owner = address(this);
    address user = address(0xBEEF);

    uint256 constant START_RATE = 1e6; // 1 USDC per share

    function setUp() public {
        usdc = new MockUSDC();
        auth = new SimpleRolesAuthority(owner);

        // ---- vault A (RegimeShift) ----
        vaultA = new BoringVault(owner, "Regime Vault", "rVLT", 18);
        accA = new Accountant(owner, address(vaultA), 6, START_RATE);
        tellerA = new Teller(owner, address(vaultA), address(accA), address(usdc));

        // ---- vault B (CarryFarm) ----
        vaultB = new BoringVault(owner, "Basis Vault", "bVLT", 18);
        accB = new Accountant(owner, address(vaultB), 6, START_RATE);
        tellerB = new Teller(owner, address(vaultB), address(accB), address(usdc));

        // ---- meta allocator ----
        MetaAllocator.VaultInfo[2] memory infos;
        infos[0] = MetaAllocator.VaultInfo(tellerA, accA, ERC20(address(vaultA)));
        infos[1] = MetaAllocator.VaultInfo(tellerB, accB, ERC20(address(vaultB)));
        allocator = new MetaAllocator(owner, address(usdc), infos);

        // ---- wire capabilities: tellers may enter/exit their vaults ----
        _setAuthority(vaultA);
        _setAuthority(vaultB);
        auth.setCapability(address(tellerA), address(vaultA), BoringVault.enter.selector, true);
        auth.setCapability(address(tellerA), address(vaultA), BoringVault.exit.selector, true);
        auth.setCapability(address(tellerB), address(vaultB), BoringVault.enter.selector, true);
        auth.setCapability(address(tellerB), address(vaultB), BoringVault.exit.selector, true);

        usdc.mint(user, 1_000_000e6);
    }

    function _setAuthority(BoringVault v) internal {
        v.setAuthority(Authority(address(auth)));
    }

    function test_deposit_splits_evenly_at_inception() public {
        // both vaults flat -> A wins ties -> tilt to A at maxWeight default 80/20
        vm.startPrank(user);
        usdc.approve(address(allocator), 100_000e6);
        allocator.deposit(100_000e6, 0);
        vm.stopPrank();

        (uint16 wA, uint16 wB) = allocator.previewSplit();
        assertEq(wA, 8000);
        assertEq(wB, 2000);
        assertApproxEqAbs(allocator.vaultNav(0), 80_000e6, 1e6);
        assertApproxEqAbs(allocator.vaultNav(1), 20_000e6, 1e6);
        assertGt(allocator.balanceOf(user), 0);
    }

    function test_tilt_follows_the_winner() public {
        // make vault B outperform
        vm.warp(block.timestamp + 2 hours);
        accB.updateExchangeRate(1.05e6); // +5%
        (uint16 wA, uint16 wB) = allocator.previewSplit();
        assertEq(wB, 8000);
        assertEq(wA, 2000);
    }

    function test_circuit_breaker_cuts_blown_vault_to_zero() public {
        // Allow a large single move + no delay so we isolate the DRAWDOWN breaker.
        // (The pause tripwire on an insane single jump is covered by the test below.)
        accA.setBounds(1000, 5000, 0); // +10% / -50% / no min delay
        accA.updateExchangeRate(1.05e6); // pump: HWM = 1.05
        accA.updateExchangeRate(0.80e6); // dump: -23.8% from HWM -> past the 20% breaker

        assertTrue(allocator.inBreaker(0));
        (uint16 wA, uint16 wB) = allocator.previewSplit();
        assertEq(wA, 0);
        assertEq(wB, 10000);
    }

    function test_accountant_pauses_on_insane_rate() public {
        vm.warp(block.timestamp + 2 hours);
        accA.updateExchangeRate(5e6); // +400% in one update -> tripwire
        assertTrue(accA.paused());
    }
}
