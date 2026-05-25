// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Script, console2} from "forge-std/Script.sol";
import {ManagerWithMerkleVerification} from "../src/ManagerWithMerkleVerification.sol";

/**
 * @notice Sets each strategist's merkle root AFTER deploy.
 *
 *   Why this is separate from Deploy.s.sol: the USYC park/unpark leaves pin the vault address as the
 *   deposit/redeem recipient, so the roots depend on the deployed vault addresses. Order of ops:
 *     1. forge script Deploy.s.sol --broadcast        (vaults get addresses)
 *     2. paste vault addresses into offchain/src/config.ts
 *     3. cd offchain && npm run build-tree             (roots now use the real vault addresses)
 *     4. forge script SetRoots.s.sol --broadcast       (this script, with the fresh roots)
 *
 *   env: PRIVATE_KEY (owner), REGIME_MANAGER, CARRY_MANAGER, REGIME_STRATEGIST, CARRY_STRATEGIST,
 *        REGIME_ROOT, CARRY_ROOT.
 *
 *   forge script script/SetRoots.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
 */
contract SetRoots is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        ManagerWithMerkleVerification(vm.envAddress("REGIME_MANAGER")).setManageRoot(
            vm.envAddress("REGIME_STRATEGIST"), vm.envBytes32("REGIME_ROOT")
        );
        ManagerWithMerkleVerification(vm.envAddress("CARRY_MANAGER")).setManageRoot(
            vm.envAddress("CARRY_STRATEGIST"), vm.envBytes32("CARRY_ROOT")
        );

        vm.stopBroadcast();
        console2.log("manage roots set for both strategists");
    }
}
