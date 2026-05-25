// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Auth, Authority} from "solmate/auth/Auth.sol";

/**
 * @title AgentJournal
 * @notice The on-chain deliberation log — "the agent thinking out loud in the agora."
 *
 *         Each rebalance cycle, the strategist records the keccak256 hash of its full reasoning
 *         trace (with an IPFS CID for the text itself), tying an immutable, timestamped, verifiable
 *         rationale to the actions it took. The decision and the reasoning behind it become a
 *         first-class, auditable artifact — not a log line that disappears.
 *
 *         This is only economical because Arc settles at ~$0.01/tx: publishing a reasoning trace
 *         on every cycle would erode PnL on a normal L1, but here it's free enough to be the norm.
 *         Auth-gated so only the registered agent EOAs can write.
 */
contract AgentJournal is Auth {
    struct Entry {
        address agent;
        uint64 timestamp;
        bytes32 decisionHash; // keccak256 of the full reasoning trace
        string view_; // the agent's market view this cycle (e.g. "risk_on")
        uint16 confidenceBps; // 0..10000
        string ipfsCid; // full trace pinned off-chain (IPFS/Irys)
    }

    uint256 public count;
    mapping(uint256 => Entry) public entries;

    event Deliberation(
        uint256 indexed id,
        address indexed agent,
        bytes32 decisionHash,
        string view_,
        uint16 confidenceBps,
        string ipfsCid,
        uint64 timestamp
    );

    constructor(address _owner) Auth(_owner, Authority(address(0))) {}

    function record(bytes32 decisionHash, string calldata view_, uint16 confidenceBps, string calldata ipfsCid)
        external
        requiresAuth
        returns (uint256 id)
    {
        require(confidenceBps <= 10_000, "conf");
        id = count++;
        entries[id] = Entry(msg.sender, uint64(block.timestamp), decisionHash, view_, confidenceBps, ipfsCid);
        emit Deliberation(id, msg.sender, decisionHash, view_, confidenceBps, ipfsCid, uint64(block.timestamp));
    }
}
