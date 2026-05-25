// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {Authority} from "solmate/auth/Auth.sol";
import {BoringVault} from "../src/BoringVault.sol";
import {Accountant} from "../src/Accountant.sol";
import {Teller} from "../src/Teller.sol";
import {ManagerWithMerkleVerification} from "../src/ManagerWithMerkleVerification.sol";
import {MetaAllocator} from "../src/MetaAllocator.sol";
import {SimpleRolesAuthority} from "../src/SimpleRolesAuthority.sol";
import {AgentJournal} from "../src/AgentJournal.sol";

/**
 * @notice Deploys both vault stacks + the MetaAllocator and wires every capability.
 *
 *   Required env:
 *     PRIVATE_KEY        deployer/owner key
 *     USDC               base asset (Arc Testnet USDC ERC-20: 0x3600000000000000000000000000000000000000)
 *     REGIME_STRATEGIST  EOA the RegimeShift keeper signs from
 *     CARRY_STRATEGIST   EOA the CarryFarm keeper signs from
 *     ORACLE             EOA allowed to push NAV updates (can equal the strategists)
 *     REGIME_ROOT        merkle root from `npm run build-tree` (offchain)
 *     CARRY_ROOT         merkle root from `npm run build-tree` (offchain)
 *
 *   forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
 *   (gas is paid in USDC on Arc — fund the deployer from faucet.circle.com)
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);
        address usdc = vm.envAddress("USDC");
        address regimeStrategist = vm.envAddress("REGIME_STRATEGIST");
        address carryStrategist = vm.envAddress("CARRY_STRATEGIST");
        address oracle = vm.envAddress("ORACLE");
        bytes32 regimeRoot = vm.envBytes32("REGIME_ROOT");
        bytes32 carryRoot = vm.envBytes32("CARRY_ROOT");

        vm.startBroadcast(pk);

        SimpleRolesAuthority auth = new SimpleRolesAuthority(owner);

        (BoringVault vA, Accountant aA, Teller tA, ManagerWithMerkleVerification mA) =
            _deployStack(owner, usdc, "Regime Vault", "rVLT");
        (BoringVault vB, Accountant aB, Teller tB, ManagerWithMerkleVerification mB) =
            _deployStack(owner, usdc, "Carry Vault", "cVLT");

        // attach authority + wire capabilities
        _wire(auth, vA, aA, tA, mA, regimeStrategist, oracle);
        _wire(auth, vB, aB, tB, mB, carryStrategist, oracle);

        // assign each strategist its allowed action set (merkle root)
        mA.setManageRoot(regimeStrategist, regimeRoot);
        mB.setManageRoot(carryStrategist, carryRoot);

        MetaAllocator.VaultInfo[2] memory infos;
        infos[0] = MetaAllocator.VaultInfo(tA, aA, ERC20(address(vA)));
        infos[1] = MetaAllocator.VaultInfo(tB, aB, ERC20(address(vB)));
        MetaAllocator allocator = new MetaAllocator(owner, usdc, infos);

        // on-chain reasoning log; both agents may record their deliberations
        AgentJournal journal = new AgentJournal(owner);
        journal.setAuthority(Authority(address(auth)));
        auth.setCapability(regimeStrategist, address(journal), AgentJournal.record.selector, true);
        auth.setCapability(carryStrategist, address(journal), AgentJournal.record.selector, true);

        vm.stopBroadcast();

        console2.log("authority   ", address(auth));
        console2.log("regime vault", address(vA));
        console2.log("carry vault ", address(vB));
        console2.log("allocator   ", address(allocator));
        console2.log("journal     ", address(journal));
    }

    function _deployStack(address owner, address usdc, string memory name, string memory sym)
        internal
        returns (BoringVault v, Accountant a, Teller t, ManagerWithMerkleVerification m)
    {
        v = new BoringVault(owner, name, sym, 18);
        a = new Accountant(owner, address(v), 6, 1e6);
        t = new Teller(owner, address(v), address(a), usdc);
        m = new ManagerWithMerkleVerification(owner, address(v));
    }

    function _wire(
        SimpleRolesAuthority auth,
        BoringVault v,
        Accountant a,
        Teller t,
        ManagerWithMerkleVerification m,
        address strategist,
        address oracle
    ) internal {
        v.setAuthority(Authority(address(auth)));
        a.setAuthority(Authority(address(auth)));
        m.setAuthority(Authority(address(auth)));

        // teller may move assets in/out of the vault
        auth.setCapability(address(t), address(v), BoringVault.enter.selector, true);
        auth.setCapability(address(t), address(v), BoringVault.exit.selector, true);
        // manager may execute strategist calls against the vault
        auth.setCapability(
            address(m), address(v), bytes4(keccak256("manage(address,bytes,uint256)")), true
        );
        // strategist may drive the manager
        auth.setCapability(
            strategist,
            address(m),
            ManagerWithMerkleVerification.manageVaultWithMerkleVerification.selector,
            true
        );
        // oracle may push NAV
        auth.setCapability(oracle, address(a), Accountant.updateExchangeRate.selector, true);
    }
}
