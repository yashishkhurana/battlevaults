// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {BaseDecoderAndSanitizer} from "./BaseDecoderAndSanitizer.sol";

/**
 * @title CarryDecoderAndSanitizer  (Arc-native)
 * @notice Allowed actions for the CarryFarm agent on Arc Testnet:
 *           - park / unpark in USYC via the USYC Teller  [T-bill yield base]
 *           - rotate a sleeve USDC <-> EURC via StableFX  [FX carry / diversification]
 *
 *         The StableFX leaf pins the two tokens being exchanged, so the agent can only swap
 *         between the pre-approved currency pair (USDC/EURC), never into an arbitrary token.
 *
 *  VERIFY signatures against the deployed contracts on testnet.arcscan.app before wiring.
 *  StableFX is an RFQ engine: the signed quote is fetched off-chain and passed as `quote`; the
 *  exact FxEscrow settlement selector/shape must be confirmed against the deployed ABI.
 */
contract CarryDecoderAndSanitizer is BaseDecoderAndSanitizer {
    // --- USYC Teller (Circle docs ABI): deposit(assets, receiver) / redeem(shares, receiver, account).
    //     Pin every recipient to the vault. ---
    function deposit(uint256, address receiver) external pure returns (bytes memory addressesFound) {
        return abi.encodePacked(receiver);
    }

    function redeem(uint256, address receiver, address account) external pure returns (bytes memory addressesFound) {
        return abi.encodePacked(receiver, account);
    }

    // --- StableFX settlement (RFQ). Representative shape: pin tokenIn + tokenOut. ---
    function settle(address tokenIn, address tokenOut, uint256, /*amountIn*/ uint256, /*minOut*/ bytes calldata /*quote*/ )
        external
        pure
        returns (bytes memory addressesFound)
    {
        return abi.encodePacked(tokenIn, tokenOut);
    }
}
