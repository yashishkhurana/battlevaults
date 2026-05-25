// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Auth, Authority} from "solmate/auth/Auth.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {BoringVault} from "./BoringVault.sol";

/**
 * @title ManagerWithMerkleVerification (minimal)
 * @notice THE guardrail, and the heart of the "trust an AI with money" story.
 *
 *         Each strategist (an off-chain AI brain) is assigned a merkle root describing the
 *         complete set of calls it is allowed to make. To execute, the strategist supplies the
 *         calls plus merkle proofs. For every call we:
 *           1. staticcall the matching DecoderAndSanitizer with the same calldata; it returns
 *              the *sensitive* address arguments (recipient, tokens, pool, perp market) packed.
 *           2. rebuild the leaf  = keccak256(decoder, target, value>0, selector, packedArgs)
 *           3. verify the leaf is in the strategist's root.
 *         Anything not in the tree reverts. The AI can propose anything; only pre-approved,
 *         pre-sanitized actions execute.
 *
 *         Leaf hashing here MUST stay byte-for-byte identical to offchain/src/merkle/leaf.ts.
 *         Verification uses OpenZeppelin's commutative (sorted-pair) MerkleProof, so the
 *         off-chain tree builder sorts sibling pairs.
 */
contract ManagerWithMerkleVerification is Auth {
    using Address for address;

    BoringVault public immutable vault;

    /// @dev strategist => merkle root of its allowed action set
    mapping(address => bytes32) public manageRoot;

    event ManageRootUpdated(address indexed strategist, bytes32 oldRoot, bytes32 newRoot);
    event StrategistManaged(address indexed strategist, uint256 callCount);

    error Manager__LengthMismatch();
    error Manager__BadProof(uint256 index, address target, bytes4 selector);

    constructor(address _owner, address _vault) Auth(_owner, Authority(address(0))) {
        vault = BoringVault(payable(_vault));
    }

    function setManageRoot(address strategist, bytes32 root) external requiresAuth {
        bytes32 old = manageRoot[strategist];
        manageRoot[strategist] = root;
        emit ManageRootUpdated(strategist, old, root);
    }

    /**
     * @param manageProofs        merkle proof per call
     * @param decodersAndSanitizers decoder to staticcall per call (pinned in the leaf)
     * @param targets             call target per call
     * @param targetData          calldata per call
     * @param values              msg.value per call
     */
    function manageVaultWithMerkleVerification(
        bytes32[][] calldata manageProofs,
        address[] calldata decodersAndSanitizers,
        address[] calldata targets,
        bytes[] calldata targetData,
        uint256[] calldata values
    ) external requiresAuth {
        uint256 n = targets.length;
        if (
            manageProofs.length != n || decodersAndSanitizers.length != n || targetData.length != n
                || values.length != n
        ) revert Manager__LengthMismatch();

        bytes32 root = manageRoot[msg.sender];
        for (uint256 i; i < n; ++i) {
            _verifyCall(root, manageProofs[i], decodersAndSanitizers[i], targets[i], targetData[i], values[i]);
            vault.manage(targets[i], targetData[i], values[i]);
        }
        emit StrategistManaged(msg.sender, n);
    }

    function _verifyCall(
        bytes32 root,
        bytes32[] calldata proof,
        address decoderAndSanitizer,
        address target,
        bytes calldata targetData,
        uint256 value
    ) internal view {
        // The decoder has a function with the SAME selector as `target`'s function; calling it
        // with `targetData` returns `bytes memory` (the sanitized addresses, abi.encodePacked).
        // staticcall hands back the ABI-encoded return value, so we abi.decode it back into the
        // raw packed bytes before hashing -- this must match packAddresses() in leaf.ts.
        bytes memory packedArgs = abi.decode(decoderAndSanitizer.functionStaticCall(targetData), (bytes));
        bytes4 selector = bytes4(targetData);
        bytes32 leaf =
            keccak256(abi.encodePacked(decoderAndSanitizer, target, value > 0, selector, packedArgs));
        if (!MerkleProof.verify(proof, root, leaf)) {
            revert Manager__BadProof(0, target, selector);
        }
    }
}
