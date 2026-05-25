// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {Auth, Authority} from "solmate/auth/Auth.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title BoringVault (minimal)
 * @notice Holds all assets and mints/burns shares. Only addresses authorized by the owner /
 *         RolesAuthority may call enter/exit (the Teller) or manage (the Manager).
 *
 *         `manage` executes an ARBITRARY call. The vault itself does not restrict what gets
 *         called -- that is the Manager's job (merkle verification). The vault simply trusts
 *         whoever holds the manage role. This separation is the whole safety model: swap the
 *         AI brain freely, the on-chain guardrail (Manager + merkle root) never changes.
 *
 *         This is a trimmed teaching version of Veda/Se7en Labs' BoringVault. Swap in your
 *         production vault by matching this interface.
 */
contract BoringVault is ERC20, Auth {
    using SafeTransferLib for ERC20;
    using Address for address;

    constructor(address _owner, string memory _name, string memory _symbol, uint8 _decimals)
        ERC20(_name, _symbol, _decimals)
        Auth(_owner, Authority(address(0)))
    {}

    // --------------------------------------------------------------------- //
    //                        Teller hooks (deposit / withdraw)              //
    // --------------------------------------------------------------------- //

    function enter(address from, ERC20 asset, uint256 assetAmount, address to, uint256 shareAmount)
        external
        requiresAuth
    {
        if (assetAmount > 0) asset.safeTransferFrom(from, address(this), assetAmount);
        _mint(to, shareAmount);
    }

    function exit(address to, ERC20 asset, uint256 assetAmount, address from, uint256 shareAmount)
        external
        requiresAuth
    {
        _burn(from, shareAmount);
        if (assetAmount > 0) asset.safeTransfer(to, assetAmount);
    }

    // --------------------------------------------------------------------- //
    //                       Manager hook (strategist execution)            //
    // --------------------------------------------------------------------- //

    function manage(address target, bytes calldata data, uint256 value)
        external
        requiresAuth
        returns (bytes memory result)
    {
        result = target.functionCallWithValue(data, value);
    }

    function manage(address[] calldata targets, bytes[] calldata data, uint256[] calldata values)
        external
        requiresAuth
        returns (bytes[] memory results)
    {
        uint256 n = targets.length;
        require(n == data.length && n == values.length, "length");
        results = new bytes[](n);
        for (uint256 i; i < n; ++i) {
            results[i] = targets[i].functionCallWithValue(data[i], values[i]);
        }
    }

    receive() external payable {}
}
