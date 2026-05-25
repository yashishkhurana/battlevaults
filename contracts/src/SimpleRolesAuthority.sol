// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Authority} from "solmate/auth/Auth.sol";

/**
 * @title SimpleRolesAuthority
 * @notice Minimal capability authority used by every contract's solmate `Auth`. The owner grants
 *         (caller, target, selector) tuples. This is the trimmed stand-in for Veda's
 *         RolesAuthority -- the production stack uses richer role bitmaps, but the wiring is the
 *         same: the Teller may call vault.enter, the Manager may call vault.manage, the oracle
 *         may call accountant.updateExchangeRate, and the strategist may call the Manager.
 */
contract SimpleRolesAuthority is Authority {
    address public owner;
    mapping(address => mapping(address => mapping(bytes4 => bool))) public allowed;

    event CapabilitySet(address indexed caller, address indexed target, bytes4 sig, bool enabled);

    constructor(address _owner) {
        owner = _owner;
    }

    function setCapability(address caller, address target, bytes4 sig, bool enabled) external {
        require(msg.sender == owner, "not owner");
        allowed[caller][target][sig] = enabled;
        emit CapabilitySet(caller, target, sig, enabled);
    }

    function canCall(address user, address target, bytes4 sig) external view returns (bool) {
        return allowed[user][target][sig];
    }
}
