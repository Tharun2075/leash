// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PolicyVault
/// @notice Non-custodial spending policy, human-approval gate, and payment receipt registry for Leash.
contract PolicyVault is Ownable {
    /// @notice Policy check result codes (shared order across contracts and TS agent).
    enum Reason {
        OK,
        NO_POLICY,
        ZERO_AMOUNT,
        NOT_ALLOWED_MERCHANT,
        OVER_PER_PAYMENT,
        OVER_DAILY_CAP,
        COOLDOWN
    }

    /// @notice Lifecycle state of a payment intent.
    enum IntentStatus {
        None,
        Pending,
        Approved,
        Settled,
        Cancelled
    }

    /// @notice Per-agent spending policy denominated in micro-USD (1 USD = 1_000_000).
    struct Policy {
        uint256 dailyCap;
        uint256 maxPerPayment;
        uint64 cooldown;
        bool active;
    }

    /// @notice Recorded payment intent created by an AI buyer agent.
    struct Intent {
        address agent;
        address merchant;
        uint256 amount;
        uint64 createdAt;
        uint32 day;
        IntentStatus status;
        bytes32 quoteRef;
    }

    /// @notice Settlement receipt linking an approved intent to HSP Gateway execution.
    struct Receipt {
        bytes32 flowIdHash;
        bytes32 paymentRequestIdHash;
        bytes32 policyHash;
        bytes32 hspTxHash;
        uint64 settledAt;
    }

    mapping(address => Policy) public policies;
    mapping(address => mapping(address => bool)) public merchantAllowed;
    mapping(address => mapping(uint256 => uint256)) public spentOnDay;
    mapping(address => uint64) public lastPaymentAt;
    uint256 public nextIntentId = 1;

    mapping(uint256 => Intent) private _intents;
    mapping(uint256 => Receipt) private _receipts;

    error PolicyBlocked(uint8 reason);
    error NotAgent();
    error BadStatus(uint8 current);
    error NotOwnerOrAgent();

    event PolicySet(address indexed agent, uint256 dailyCap, uint256 maxPerPayment, uint64 cooldown);
    event MerchantSet(address indexed agent, address indexed merchant, bool allowed);
    event PolicyPaused(address indexed agent);
    event PaymentRequested(
        uint256 indexed intentId,
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        bytes32 quoteRef
    );
    event PaymentApproved(uint256 indexed intentId);
    event PaymentCancelled(uint256 indexed intentId);
    event ReceiptMinted(
        uint256 indexed intentId,
        bytes32 flowIdHash,
        bytes32 paymentRequestIdHash,
        bytes32 policyHash,
        bytes32 hspTxHash
    );

    /// @notice Initializes the vault with the human owner.
    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Sets or updates an agent's spending policy and activates it.
    function setPolicy(
        address agent,
        uint256 dailyCap,
        uint256 maxPerPayment,
        uint64 cooldown
    ) external onlyOwner {
        policies[agent] = Policy({
            dailyCap: dailyCap,
            maxPerPayment: maxPerPayment,
            cooldown: cooldown,
            active: true
        });
        emit PolicySet(agent, dailyCap, maxPerPayment, cooldown);
    }

    /// @notice Grants or revokes merchant allowlist permission for an agent.
    function setMerchant(address agent, address merchant, bool allowed) external onlyOwner {
        merchantAllowed[agent][merchant] = allowed;
        emit MerchantSet(agent, merchant, allowed);
    }

    /// @notice Pauses an agent's policy without deleting its parameters.
    function pausePolicy(address agent) external onlyOwner {
        policies[agent].active = false;
        emit PolicyPaused(agent);
    }

    /// @notice Evaluates whether an agent payment complies with its active policy.
    function check(address agent, address merchant, uint256 amount) public view returns (Reason) {
        Policy memory p = policies[agent];
        if (!p.active) return Reason.NO_POLICY;
        if (amount == 0) return Reason.ZERO_AMOUNT;
        if (!merchantAllowed[agent][merchant]) return Reason.NOT_ALLOWED_MERCHANT;
        if (amount > p.maxPerPayment) return Reason.OVER_PER_PAYMENT;

        uint256 day = block.timestamp / 86400;
        uint256 spent = spentOnDay[agent][day];
        if (spent >= p.dailyCap || amount > p.dailyCap - spent) return Reason.OVER_DAILY_CAP;

        uint64 last = lastPaymentAt[agent];
        if (last != 0 && block.timestamp < uint256(last) + uint256(p.cooldown)) {
            return Reason.COOLDOWN;
        }

        return Reason.OK;
    }

    /// @notice Returns the remaining micro-USD cap available to an agent for the current UTC day.
    function remainingToday(address agent) external view returns (uint256) {
        Policy memory p = policies[agent];
        if (!p.active) return 0;
        uint256 spent = spentOnDay[agent][block.timestamp / 86400];
        return spent >= p.dailyCap ? 0 : p.dailyCap - spent;
    }

    /// @notice Computes the canonical hash of an agent's current policy state.
    function policyHash(address agent) public view returns (bytes32) {
        Policy memory p = policies[agent];
        return keccak256(abi.encode(p.dailyCap, p.maxPerPayment, p.cooldown, p.active));
    }

    /// @notice Returns the stored intent for a given intent ID.
    function getIntent(uint256 intentId) external view returns (Intent memory) {
        return _intents[intentId];
    }

    /// @notice Returns the stored receipt for a settled intent ID.
    function getReceipt(uint256 intentId) external view returns (Receipt memory) {
        return _receipts[intentId];
    }

    /// @notice Called by an agent to validate policy and reserve daily budget for a pending intent.
    function requestPayment(
        address merchant,
        uint256 amount,
        bytes32 quoteRef
    ) external returns (uint256 intentId) {
        Reason reason = check(msg.sender, merchant, amount);
        if (reason != Reason.OK) revert PolicyBlocked(uint8(reason));

        uint256 day = block.timestamp / 86400;
        spentOnDay[msg.sender][day] += amount;
        lastPaymentAt[msg.sender] = uint64(block.timestamp);

        intentId = nextIntentId++;
        _intents[intentId] = Intent({
            agent: msg.sender,
            merchant: merchant,
            amount: amount,
            createdAt: uint64(block.timestamp),
            day: uint32(day),
            status: IntentStatus.Pending,
            quoteRef: quoteRef
        });

        emit PaymentRequested(intentId, msg.sender, merchant, amount, quoteRef);
    }

    /// @notice Human-approval gate transitioning a Pending intent to Approved.
    function approve(uint256 intentId) external onlyOwner {
        Intent storage intent = _intents[intentId];
        if (intent.status != IntentStatus.Pending) {
            revert BadStatus(uint8(intent.status));
        }

        intent.status = IntentStatus.Approved;
        emit PaymentApproved(intentId);
    }

    /// @notice Cancels a Pending or Approved intent and releases its daily spend reservation.
    function cancel(uint256 intentId) external {
        Intent storage intent = _intents[intentId];
        if (msg.sender != owner() && msg.sender != intent.agent) {
            revert NotOwnerOrAgent();
        }
        if (intent.status != IntentStatus.Pending && intent.status != IntentStatus.Approved) {
            revert BadStatus(uint8(intent.status));
        }

        intent.status = IntentStatus.Cancelled;
        spentOnDay[intent.agent][intent.day] -= intent.amount;

        emit PaymentCancelled(intentId);
    }

    /// @notice Finalizes an Approved intent by recording the HSP Gateway settlement receipt.
    function settle(
        uint256 intentId,
        bytes32 flowIdHash,
        bytes32 paymentRequestIdHash,
        bytes32 hspTxHash
    ) external {
        Intent storage intent = _intents[intentId];
        if (msg.sender != intent.agent) revert NotAgent();
        if (intent.status != IntentStatus.Approved) {
            revert BadStatus(uint8(intent.status));
        }

        intent.status = IntentStatus.Settled;
        bytes32 pHash = policyHash(intent.agent);

        _receipts[intentId] = Receipt({
            flowIdHash: flowIdHash,
            paymentRequestIdHash: paymentRequestIdHash,
            policyHash: pHash,
            hspTxHash: hspTxHash,
            settledAt: uint64(block.timestamp)
        });

        emit ReceiptMinted(intentId, flowIdHash, paymentRequestIdHash, pHash, hspTxHash);
    }
}
