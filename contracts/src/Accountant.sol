// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import {Auth, Authority} from "solmate/auth/Auth.sol";

/**
 * @title Accountant (minimal)
 * @notice Tracks the vault's exchange rate (base asset per 1e18 shares). An off-chain oracle /
 *         strategist pushes the rate, but ONLY within bounds -- a too-large jump auto-pauses the
 *         vault. So this contract is two things at once:
 *           1. the NAV source  -> 'returns vs benchmark' traction metric + the scoreboard.
 *           2. a guardrail      -> a hallucinating AI cannot print a fake 10x NAV.
 *
 *         It also tracks a high-water mark, which the MetaAllocator's circuit-breaker reads via
 *         `drawdownBps()` to cut a blown-up vault to 0% allocation.
 */
contract Accountant is Auth {
    address public immutable vault;
    uint8 public immutable baseDecimals; // e.g. 6 for USDC

    uint256 public exchangeRate; // base asset per 1e18 shares (start: 1e6 == 1 USDC / share)
    uint256 public highWaterRate;
    uint64 public lastUpdate;

    uint16 public allowedUpperBps = 1000; // +10% max per update
    uint16 public allowedLowerBps = 2000; // -20% max per update (allow faster de-risking)
    uint32 public minUpdateDelay = 3600; // 1h between updates
    bool public paused;

    event RateUpdated(uint256 oldRate, uint256 newRate, uint256 highWaterRate);
    event Paused(uint256 attemptedRate);

    error Accountant__Paused();
    error Accountant__TooSoon();

    constructor(address _owner, address _vault, uint8 _baseDecimals, uint256 _startRate)
        Auth(_owner, Authority(address(0)))
    {
        vault = _vault;
        baseDecimals = _baseDecimals;
        exchangeRate = _startRate;
        highWaterRate = _startRate;
        lastUpdate = uint64(block.timestamp);
    }

    function updateExchangeRate(uint256 newRate) external requiresAuth {
        if (paused) revert Accountant__Paused();
        if (block.timestamp < lastUpdate + minUpdateDelay) revert Accountant__TooSoon();

        uint256 upper = exchangeRate + (exchangeRate * allowedUpperBps) / 10_000;
        uint256 lower = exchangeRate - (exchangeRate * allowedLowerBps) / 10_000;
        if (newRate > upper || newRate < lower) {
            paused = true; // tripwire: refuse the update and freeze
            emit Paused(newRate);
            return;
        }

        uint256 old = exchangeRate;
        exchangeRate = newRate;
        if (newRate > highWaterRate) highWaterRate = newRate;
        lastUpdate = uint64(block.timestamp);
        emit RateUpdated(old, newRate, highWaterRate);
    }

    function getRate() external view returns (uint256) {
        return exchangeRate;
    }

    /// @notice drawdown from the high-water mark, in bps. 0 == at or above HWM.
    function drawdownBps() external view returns (uint256) {
        if (highWaterRate == 0 || exchangeRate >= highWaterRate) return 0;
        return ((highWaterRate - exchangeRate) * 10_000) / highWaterRate;
    }

    function setBounds(uint16 _upperBps, uint16 _lowerBps, uint32 _minDelay) external requiresAuth {
        allowedUpperBps = _upperBps;
        allowedLowerBps = _lowerBps;
        minUpdateDelay = _minDelay;
    }

    function setPaused(bool p) external requiresAuth {
        paused = p;
    }
}
