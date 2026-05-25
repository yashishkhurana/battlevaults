// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {BaseDecoderAndSanitizer} from "./BaseDecoderAndSanitizer.sol";

/**
 * @title RegimeDecoderAndSanitizer  (Arc-native)
 * @notice Allowed actions for the RegimeShift agent on Arc Testnet:
 *           - park / unpark in USYC (tokenized T-bills) via the USYC Teller  [risk-off yield]
 *           - bridge USDC to the sister "risk" vault on another chain via CCTP v2  [risk-on]
 *
 *         There is no DEX/perps on Arc, so "risk-on" means deploying capital cross-chain (where
 *         risk venues live) and "risk-off" means sitting in USYC. The CCTP leaf pins burnToken,
 *         mintRecipient, AND destinationDomain, so the agent can only ever bridge USDC to the
 *         pre-approved sister vault, on the pre-approved chain — never to an arbitrary destination.
 *
 *  VERIFY on testnet.arcscan.app before wiring: the USYC Teller deposit/redeem ABI (per Circle docs)
 *  and CCTP v2 TokenMessenger.depositForBurn.
 */
contract RegimeDecoderAndSanitizer is BaseDecoderAndSanitizer {
    // --- USYC Teller (Circle docs ABI) ---
    // deposit(assets, receiver) subscribes; redeem(shares, receiver, account) redeems.
    // Pin every recipient so the agent can only mint USYC to, and redeem USDC to, the vault itself.
    function deposit(uint256, address receiver) external pure returns (bytes memory addressesFound) {
        return abi.encodePacked(receiver);
    }

    function redeem(uint256, address receiver, address account) external pure returns (bytes memory addressesFound) {
        return abi.encodePacked(receiver, account);
    }

    // --- CCTP v2 TokenMessenger.depositForBurn ---
    // depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold)
    function depositForBurn(
        uint256, /*amount*/
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32, /*destinationCaller*/
        uint256, /*maxFee*/
        uint32 /*minFinalityThreshold*/
    ) external pure returns (bytes memory addressesFound) {
        // pin the token, the destination recipient (sister vault), AND the destination domain, so the
        // agent cannot redirect the bridge to another chain (audit finding #1). Mirrored off-chain in
        // offchain/src/merkle/bundles.ts -> argExtraPacked.
        return abi.encodePacked(burnToken, address(uint160(uint256(mintRecipient))), destinationDomain);
    }
}
