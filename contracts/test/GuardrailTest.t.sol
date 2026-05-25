// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {Authority} from "solmate/auth/Auth.sol";
import {BoringVault} from "../src/BoringVault.sol";
import {ManagerWithMerkleVerification} from "../src/ManagerWithMerkleVerification.sol";
import {BaseDecoderAndSanitizer} from "../src/decoders/BaseDecoderAndSanitizer.sol";
import {RegimeDecoderAndSanitizer} from "../src/decoders/RegimeDecoderAndSanitizer.sol";
import {SimpleRolesAuthority} from "../src/SimpleRolesAuthority.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC", 6) {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// minimal CCTP v2 TokenMessenger stand-in for the bridge-domain guardrail test
contract MockTokenMessenger {
    event Burned(uint256 amount, uint32 domain, bytes32 recipient, address token);

    function depositForBurn(uint256 amount, uint32 domain, bytes32 recipient, address token, bytes32, uint256, uint32)
        external
        returns (uint64)
    {
        emit Burned(amount, domain, recipient, token);
        return 0;
    }
}

/// minimal USYC Teller stand-in (Circle docs ABI) for the recipient-pinning guardrail test
contract MockUsycTeller {
    function deposit(uint256 assets, address) external pure returns (uint256) {
        return assets;
    }

    function redeem(uint256 shares, address, address) external pure returns (uint256) {
        return shares;
    }
}

/**
 * @notice THE thesis test — "you can let an autonomous agent manage the money because it is bounded."
 *
 *         The agent's ENTIRE allowed action set here is a single leaf: `approve(APPROVED_SPENDER)`
 *         on USDC. We then prove:
 *           1. that exact call SUCCEEDS,
 *           2. the SAME function on the SAME token but to a different recipient REVERTS (BadProof),
 *           3. the same call to a different target REVERTS (BadProof),
 *           4. a caller that isn't the registered agent REVERTS (UNAUTHORIZED).
 *
 *         #2 is the money shot: the AI can be prompt-injected, hallucinate, or be outright
 *         malicious, and it still physically cannot move funds to an address that wasn't
 *         pre-sanitized into the merkle root.
 *
 *   forge test --match-contract Guardrail -vv
 */
contract GuardrailTest is Test {
    TestToken usdc;
    BoringVault vault;
    ManagerWithMerkleVerification manager;
    BaseDecoderAndSanitizer decoder;
    SimpleRolesAuthority auth;

    address owner = address(this);
    address strategist = address(0xA11CE); // the AI keeper's signing key
    address constant APPROVED_SPENDER = address(0x1111); // the ONE spender the agent may approve
    address constant EVIL = address(0xBAD); // an address the agent must never reach

    bytes32 root;

    function setUp() public {
        usdc = new TestToken();
        auth = new SimpleRolesAuthority(owner);
        vault = new BoringVault(owner, "Vault", "VLT", 18);
        manager = new ManagerWithMerkleVerification(owner, address(vault));
        decoder = new BaseDecoderAndSanitizer();

        vault.setAuthority(Authority(address(auth)));
        manager.setAuthority(Authority(address(auth)));
        // manager may call vault.manage; strategist may drive the manager
        auth.setCapability(address(manager), address(vault), bytes4(keccak256("manage(address,bytes,uint256)")), true);
        auth.setCapability(
            strategist, address(manager), ManagerWithMerkleVerification.manageVaultWithMerkleVerification.selector, true
        );

        // The entire allowed action set: approve(APPROVED_SPENDER) on USDC. 1-leaf tree -> root = leaf.
        root = _leaf(address(usdc), false, ERC20.approve.selector, abi.encodePacked(APPROVED_SPENDER));
        manager.setManageRoot(strategist, root);

        usdc.mint(address(vault), 1_000e6);
    }

    function _leaf(address target, bool valueNonZero, bytes4 selector, bytes memory packedArgs)
        internal
        view
        returns (bytes32)
    {
        // must match ManagerWithMerkleVerification._verifyCall exactly
        return keccak256(abi.encodePacked(address(decoder), target, valueNonZero, selector, packedArgs));
    }

    /// single-call execution with an empty proof (valid for a 1-leaf tree), pranked as the agent
    function _execAsStrategist(address target, bytes memory data) internal {
        bytes32[][] memory proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);
        address[] memory decoders = new address[](1);
        decoders[0] = address(decoder);
        address[] memory targets = new address[](1);
        targets[0] = target;
        bytes[] memory datas = new bytes[](1);
        datas[0] = data;
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        vm.prank(strategist);
        manager.manageVaultWithMerkleVerification(proofs, decoders, targets, datas, values);
    }

    function test_allowed_call_succeeds() public {
        _execAsStrategist(address(usdc), abi.encodeWithSelector(ERC20.approve.selector, APPROVED_SPENDER, uint256(100e6)));
        assertEq(usdc.allowance(address(vault), APPROVED_SPENDER), 100e6);
    }

    function test_evil_recipient_reverts() public {
        // same function, same token, but a recipient that isn't in the root
        vm.expectPartialRevert(ManagerWithMerkleVerification.Manager__BadProof.selector);
        _execAsStrategist(address(usdc), abi.encodeWithSelector(ERC20.approve.selector, EVIL, uint256(100e6)));
        // and nothing was granted to EVIL
        assertEq(usdc.allowance(address(vault), EVIL), 0);
    }

    function test_wrong_target_reverts() public {
        // correct (approved) calldata, but pointed at a different contract
        vm.expectPartialRevert(ManagerWithMerkleVerification.Manager__BadProof.selector);
        _execAsStrategist(address(0xDEAD), abi.encodeWithSelector(ERC20.approve.selector, APPROVED_SPENDER, uint256(1e6)));
    }

    function test_unauthorized_caller_reverts() public {
        bytes32[][] memory proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);
        address[] memory decoders = new address[](1);
        decoders[0] = address(decoder);
        address[] memory targets = new address[](1);
        targets[0] = address(usdc);
        bytes[] memory datas = new bytes[](1);
        datas[0] = abi.encodeWithSelector(ERC20.approve.selector, APPROVED_SPENDER, uint256(1e6));
        uint256[] memory values = new uint256[](1);
        values[0] = 0;

        vm.prank(EVIL); // not the registered agent
        vm.expectRevert(bytes("UNAUTHORIZED"));
        manager.manageVaultWithMerkleVerification(proofs, decoders, targets, datas, values);
    }

    // ---- audit finding #1 fix: the CCTP destination domain is now pinned into the leaf ----

    function test_cctp_correct_domain_succeeds() public {
        (RegimeDecoderAndSanitizer rdec, MockTokenMessenger cctp, address remote, uint32 good,) = _bridgeSetup();
        _execBridge(rdec, cctp, good, remote); // pinned domain -> passes
    }

    function test_cctp_wrong_domain_reverts() public {
        (RegimeDecoderAndSanitizer rdec, MockTokenMessenger cctp, address remote,, uint32 bad) = _bridgeSetup();
        // identical recipient, but a different chain -> rejected by the merkle guardrail
        vm.expectPartialRevert(ManagerWithMerkleVerification.Manager__BadProof.selector);
        _execBridge(rdec, cctp, bad, remote);
    }

    function _bridgeSetup()
        internal
        returns (RegimeDecoderAndSanitizer rdec, MockTokenMessenger cctp, address remote, uint32 good, uint32 bad)
    {
        rdec = new RegimeDecoderAndSanitizer();
        cctp = new MockTokenMessenger();
        remote = address(0x5151);
        good = 6;
        bad = 7;
        // 1-leaf root pinning burnToken=USDC, recipient=remote, AND destinationDomain=good
        bytes memory pinned = abi.encodePacked(address(usdc), remote, good);
        bytes32 leaf = keccak256(
            abi.encodePacked(
                address(rdec), address(cctp), false, RegimeDecoderAndSanitizer.depositForBurn.selector, pinned
            )
        );
        manager.setManageRoot(strategist, leaf);
    }

    function _execBridge(RegimeDecoderAndSanitizer rdec, MockTokenMessenger cctp, uint32 domain, address remote)
        internal
    {
        bytes memory data = abi.encodeWithSelector(
            RegimeDecoderAndSanitizer.depositForBurn.selector,
            uint256(1e6),
            domain,
            bytes32(uint256(uint160(remote))),
            address(usdc),
            bytes32(0),
            uint256(0),
            uint32(1000)
        );
        bytes32[][] memory proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);
        address[] memory decoders = new address[](1);
        decoders[0] = address(rdec);
        address[] memory targets = new address[](1);
        targets[0] = address(cctp);
        bytes[] memory datas = new bytes[](1);
        datas[0] = data;
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        vm.prank(strategist);
        manager.manageVaultWithMerkleVerification(proofs, decoders, targets, datas, values);
    }

    // ---- USYC recipient pinning (audit lead resolved): agent can only mint USYC to the vault ----

    function test_usyc_deposit_to_vault_succeeds() public {
        (RegimeDecoderAndSanitizer rdec, MockUsycTeller teller) = _usycSetup();
        _execUsycDeposit(rdec, teller, address(vault)); // receiver == vault -> passes
    }

    function test_usyc_deposit_wrong_receiver_reverts() public {
        (RegimeDecoderAndSanitizer rdec, MockUsycTeller teller) = _usycSetup();
        // minting USYC to an address other than the vault -> rejected
        vm.expectPartialRevert(ManagerWithMerkleVerification.Manager__BadProof.selector);
        _execUsycDeposit(rdec, teller, EVIL);
    }

    function _usycSetup() internal returns (RegimeDecoderAndSanitizer rdec, MockUsycTeller teller) {
        rdec = new RegimeDecoderAndSanitizer();
        teller = new MockUsycTeller();
        // 1-leaf root pinning deposit receiver = the vault
        bytes32 leaf = keccak256(
            abi.encodePacked(
                address(rdec),
                address(teller),
                false,
                RegimeDecoderAndSanitizer.deposit.selector,
                abi.encodePacked(address(vault))
            )
        );
        manager.setManageRoot(strategist, leaf);
    }

    function _execUsycDeposit(RegimeDecoderAndSanitizer rdec, MockUsycTeller teller, address receiver) internal {
        bytes memory data = abi.encodeWithSelector(RegimeDecoderAndSanitizer.deposit.selector, uint256(1e6), receiver);
        bytes32[][] memory proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);
        address[] memory decoders = new address[](1);
        decoders[0] = address(rdec);
        address[] memory targets = new address[](1);
        targets[0] = address(teller);
        bytes[] memory datas = new bytes[](1);
        datas[0] = data;
        uint256[] memory values = new uint256[](1);
        values[0] = 0;
        vm.prank(strategist);
        manager.manageVaultWithMerkleVerification(proofs, decoders, targets, datas, values);
    }
}
