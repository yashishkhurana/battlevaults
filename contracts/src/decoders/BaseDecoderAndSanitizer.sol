// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

/**
 * @title BaseDecoderAndSanitizer
 * @notice For every protocol call a strategist is allowed to make, there is a function here with
 *         the SAME selector as the target function. The Manager staticcalls this contract with
 *         the strategist's calldata; the matching function decodes it and returns the *sensitive*
 *         address arguments (spender, recipient, tokens, pools, markets) packed with
 *         abi.encodePacked. Those bytes are hashed into the merkle leaf.
 *
 *         SECURITY: any argument you do NOT return here is effectively unconstrained. Under-
 *         sanitizing is the single highest-severity bug in this whole design -- e.g. forgetting
 *         to pin a bridge `recipient` lets the AI send funds anywhere. Treat additions to these
 *         decoders as the most security-sensitive change you can make. (Run the solidity-auditor.)
 */
contract BaseDecoderAndSanitizer {
    /// ERC20.approve(address spender, uint256 amount)
    function approve(address spender, uint256) external pure returns (bytes memory addressesFound) {
        return abi.encodePacked(spender);
    }

    /// ERC20.transfer(address to, uint256 amount)
    function transfer(address to, uint256) external pure returns (bytes memory addressesFound) {
        return abi.encodePacked(to);
    }
}
