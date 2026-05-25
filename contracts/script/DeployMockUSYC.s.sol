// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSYC, MockUSYCTeller} from "../src/mocks/MockUSYC.sol";

/**
 * @notice Deploys a testnet mock USYC (token + teller) for use when the real USYC Entitlements
 *         allowlist isn't available. After deploy: set ADDR.USYC = MOCK_USYC and
 *         ADDR.USYC_TELLER = MOCK_USYC_TELLER in config.ts, `npm run build-tree`, then SetRoots.
 *
 *   env: PRIVATE_KEY, USDC
 *   forge script script/DeployMockUSYC.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
 */
contract DeployMockUSYC is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC");

        vm.startBroadcast(pk);
        MockUSYC usyc = new MockUSYC();
        MockUSYCTeller teller = new MockUSYCTeller(usdc, address(usyc));
        usyc.setTeller(address(teller));
        vm.stopBroadcast();

        console2.log("MOCK_USYC  (-> ADDR.USYC)       ", address(usyc));
        console2.log("MOCK_USYC_TELLER (-> ADDR.USYC_TELLER)", address(teller));
    }
}
