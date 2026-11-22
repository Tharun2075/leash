// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PolicyVault} from "../src/PolicyVault.sol";

contract PolicyVaultTest is Test {
    PolicyVault internal vault;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal merchant = makeAddr("merchant");
    address internal otherMerchant = makeAddr("otherMerchant");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant DAILY_CAP = 10_000_000; // 10.00 USD
    uint256 internal constant MAX_PER_PAYMENT = 6_000_000; // 6.00 USD
    uint64 internal constant COOLDOWN = 60; // 60 seconds

    bytes32 internal constant QUOTE_REF = keccak256("quote-1");
    bytes32 internal constant FLOW_ID_HASH = keccak256("flow-1");
    bytes32 internal constant PAYMENT_REQ_HASH = keccak256("req-1");
    bytes32 internal constant HSP_TX_HASH = keccak256("tx-1");

    function setUp() public {
        vm.warp(1_700_000_000);
        vault = new PolicyVault(owner);

        vm.startPrank(owner);
        vault.setPolicy(agent, DAILY_CAP, MAX_PER_PAYMENT, COOLDOWN);
        vault.setMerchant(agent, merchant, true);
        vm.stopPrank();
    }

    function test_HappyPath_RequestApproveSettle() public {
        uint256 amount = 4_000_000;
        uint256 expectedDay = block.timestamp / 86400;

        assertEq(uint8(vault.check(agent, merchant, amount)), uint8(PolicyVault.Reason.OK));
        assertEq(vault.remainingToday(agent), DAILY_CAP);
        assertEq(vault.nextIntentId(), 1);

        vm.expectEmit(true, true, true, true, address(vault));
        emit PolicyVault.PaymentRequested(1, agent, merchant, amount, QUOTE_REF);

        vm.prank(agent);
        uint256 intentId = vault.requestPayment(merchant, amount, QUOTE_REF);

        assertEq(intentId, 1);
        assertEq(vault.nextIntentId(), 2);
        assertEq(vault.spentOnDay(agent, expectedDay), amount);
        assertEq(vault.remainingToday(agent), DAILY_CAP - amount);
        assertEq(vault.lastPaymentAt(agent), uint64(block.timestamp));

        PolicyVault.Intent memory intent = vault.getIntent(intentId);
        assertEq(intent.agent, agent);
        assertEq(intent.merchant, merchant);
        assertEq(intent.amount, amount);
        assertEq(intent.createdAt, uint64(block.timestamp));
        assertEq(intent.day, uint32(expectedDay));
        assertEq(uint8(intent.status), uint8(PolicyVault.IntentStatus.Pending));
        assertEq(intent.quoteRef, QUOTE_REF);

        vm.expectEmit(true, false, false, true, address(vault));
        emit PolicyVault.PaymentApproved(intentId);

        vm.prank(owner);
        vault.approve(intentId);
        assertEq(uint8(vault.getIntent(intentId).status), uint8(PolicyVault.IntentStatus.Approved));

        vm.warp(block.timestamp + 15);
        bytes32 expectedPolicyHash = vault.policyHash(agent);

        vm.expectEmit(true, false, false, true, address(vault));
        emit PolicyVault.ReceiptMinted(
            intentId,
            FLOW_ID_HASH,
            PAYMENT_REQ_HASH,
            expectedPolicyHash,
            HSP_TX_HASH
        );

        vm.prank(agent);
        vault.settle(intentId, FLOW_ID_HASH, PAYMENT_REQ_HASH, HSP_TX_HASH);

        assertEq(uint8(vault.getIntent(intentId).status), uint8(PolicyVault.IntentStatus.Settled));

        PolicyVault.Receipt memory receipt = vault.getReceipt(intentId);
        assertEq(receipt.flowIdHash, FLOW_ID_HASH);
        assertEq(receipt.paymentRequestIdHash, PAYMENT_REQ_HASH);
        assertEq(receipt.policyHash, expectedPolicyHash);
        assertEq(receipt.hspTxHash, HSP_TX_HASH);
        assertEq(receipt.settledAt, uint64(block.timestamp));
    }

    function test_Reason_NoPolicy_UnsetAndPaused() public {
        // Unset agent policy
        assertEq(
            uint8(vault.check(stranger, merchant, 1_000_000)),
            uint8(PolicyVault.Reason.NO_POLICY)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.PolicyBlocked.selector,
                uint8(PolicyVault.Reason.NO_POLICY)
            )
        );
        vm.prank(stranger);
        vault.requestPayment(merchant, 1_000_000, QUOTE_REF);

        // Paused existing policy (also verifies NO_POLICY precedes ZERO_AMOUNT)
        vm.prank(owner);
        vault.pausePolicy(agent);

        assertEq(vault.remainingToday(agent), 0);
        assertEq(uint8(vault.check(agent, merchant, 0)), uint8(PolicyVault.Reason.NO_POLICY));
        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.PolicyBlocked.selector,
                uint8(PolicyVault.Reason.NO_POLICY)
            )
        );
        vm.prank(agent);
        vault.requestPayment(merchant, 1_000_000, QUOTE_REF);
    }

    function test_Reason_ZeroAmount() public {
        assertEq(uint8(vault.check(agent, merchant, 0)), uint8(PolicyVault.Reason.ZERO_AMOUNT));

        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.PolicyBlocked.selector,
                uint8(PolicyVault.Reason.ZERO_AMOUNT)
            )
        );
        vm.prank(agent);
        vault.requestPayment(merchant, 0, QUOTE_REF);
    }

    function test_Reason_NotAllowedMerchant() public {
        assertEq(
            uint8(vault.check(agent, otherMerchant, 1_000_000)),
            uint8(PolicyVault.Reason.NOT_ALLOWED_MERCHANT)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.PolicyBlocked.selector,
                uint8(PolicyVault.Reason.NOT_ALLOWED_MERCHANT)
            )
        );
        vm.prank(agent);
        vault.requestPayment(otherMerchant, 1_000_000, QUOTE_REF);
    }

    function test_Reason_OverPerPayment() public {
        uint256 tooMuch = MAX_PER_PAYMENT + 1;
        assertEq(
            uint8(vault.check(agent, merchant, tooMuch)),
            uint8(PolicyVault.Reason.OVER_PER_PAYMENT)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.PolicyBlocked.selector,
                uint8(PolicyVault.Reason.OVER_PER_PAYMENT)
            )
        );
        vm.prank(agent);
        vault.requestPayment(merchant, tooMuch, QUOTE_REF);
    }

    function test_Reason_OverDailyCap() public {
        vm.prank(agent);
        vault.requestPayment(merchant, 6_000_000, QUOTE_REF);

        vm.warp(block.timestamp + COOLDOWN);

        // 5 USD is <= maxPerPayment (6 USD), but 6 + 5 > 10 USD dailyCap
        assertEq(
            uint8(vault.check(agent, merchant, 5_000_000)),
            uint8(PolicyVault.Reason.OVER_DAILY_CAP)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.PolicyBlocked.selector,
                uint8(PolicyVault.Reason.OVER_DAILY_CAP)
            )
        );
        vm.prank(agent);
        vault.requestPayment(merchant, 5_000_000, QUOTE_REF);
    }

    function test_Reason_Cooldown() public {
        vm.prank(agent);
        vault.requestPayment(merchant, 2_000_000, QUOTE_REF);

        vm.warp(block.timestamp + COOLDOWN - 1);
        assertEq(
            uint8(vault.check(agent, merchant, 2_000_000)),
            uint8(PolicyVault.Reason.COOLDOWN)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.PolicyBlocked.selector,
                uint8(PolicyVault.Reason.COOLDOWN)
            )
        );
        vm.prank(agent);
        vault.requestPayment(merchant, 2_000_000, QUOTE_REF);

        // Exactly at lastPaymentAt + cooldown succeeds
        vm.warp(block.timestamp + 1);
        assertEq(uint8(vault.check(agent, merchant, 2_000_000)), uint8(PolicyVault.Reason.OK));
    }

    function test_NonOwnerCannotAdminOrApprove() public {
        vm.prank(agent);
        uint256 intentId = vault.requestPayment(merchant, 1_000_000, QUOTE_REF);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        vault.setPolicy(agent, DAILY_CAP, MAX_PER_PAYMENT, COOLDOWN);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        vault.setMerchant(agent, otherMerchant, true);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        vault.pausePolicy(agent);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent)
        );
        vm.prank(agent);
        vault.approve(intentId);
    }

    function test_AgentCannotSettleBeforeApprove_AndNonAgentCannotSettle() public {
        vm.prank(agent);
        uint256 intentId = vault.requestPayment(merchant, 2_000_000, QUOTE_REF);

        vm.expectRevert(
            abi.encodeWithSelector(
                PolicyVault.BadStatus.selector,
                uint8(PolicyVault.IntentStatus.Pending)
            )
        );
        vm.prank(agent);
        vault.settle(intentId, FLOW_ID_HASH, PAYMENT_REQ_HASH, HSP_TX_HASH);

        vm.prank(owner);
        vault.approve(intentId);

        vm.expectRevert(PolicyVault.NotAgent.selector);
        vm.prank(owner);
        vault.settle(intentId, FLOW_ID_HASH, PAYMENT_REQ_HASH, HSP_TX_HASH);
    }

    function test_CancelReleasesDailyReservation() public {
        uint256 day = block.timestamp / 86400;

        // Agent cancels Pending intent
        vm.prank(agent);
        uint256 intent1 = vault.requestPayment(merchant, 6_000_000, QUOTE_REF);
        assertEq(vault.spentOnDay(agent, day), 6_000_000);
        assertEq(vault.remainingToday(agent), 4_000_000);

        vm.prank(agent);
        vault.cancel(intent1);

        assertEq(uint8(vault.getIntent(intent1).status), uint8(PolicyVault.IntentStatus.Cancelled));
        assertEq(vault.spentOnDay(agent, day), 0);
        assertEq(vault.remainingToday(agent), DAILY_CAP);

        // Owner cancels Approved intent
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(agent);
        uint256 intent2 = vault.requestPayment(merchant, 6_000_000, QUOTE_REF);

        vm.prank(owner);
        vault.approve(intent2);

        vm.prank(owner);
        vault.cancel(intent2);

        assertEq(uint8(vault.getIntent(intent2).status), uint8(PolicyVault.IntentStatus.Cancelled));
        assertEq(vault.spentOnDay(agent, day), 0);
        assertEq(vault.remainingToday(agent), DAILY_CAP);
    }

    function test_DayRolloverResetsDailyCap() public {
        vm.prank(agent);
        vault.requestPayment(merchant, 6_000_000, QUOTE_REF);

        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(agent);
        vault.requestPayment(merchant, 4_000_000, QUOTE_REF);

        assertEq(vault.remainingToday(agent), 0);

        // Warp to next UTC day boundary (ensure cooldown also elapsed)
        uint256 nextDayStart = (block.timestamp / 86400 + 1) * 86400;
        vm.warp(nextDayStart + COOLDOWN);

        assertEq(vault.remainingToday(agent), DAILY_CAP);
        assertEq(vault.spentOnDay(agent, block.timestamp / 86400), 0);
        assertEq(uint8(vault.check(agent, merchant, 6_000_000)), uint8(PolicyVault.Reason.OK));

        vm.prank(agent);
        uint256 newIntentId = vault.requestPayment(merchant, 6_000_000, QUOTE_REF);
        assertEq(newIntentId, 3);
        assertEq(vault.remainingToday(agent), 4_000_000);
    }

    function test_StrangerCannotCancel() public {
        vm.prank(agent);
        uint256 intentId = vault.requestPayment(merchant, 2_000_000, QUOTE_REF);

        vm.expectRevert(PolicyVault.NotOwnerOrAgent.selector);
        vm.prank(stranger);
        vault.cancel(intentId);
    }

    function test_PolicyHashChangesWhenPolicyChanges() public {
        bytes32 h1 = vault.policyHash(agent);
        assertEq(h1, keccak256(abi.encode(DAILY_CAP, MAX_PER_PAYMENT, COOLDOWN, true)));

        vm.prank(owner);
        vault.setPolicy(agent, DAILY_CAP * 2, MAX_PER_PAYMENT, COOLDOWN);
        bytes32 h2 = vault.policyHash(agent);
        assertTrue(h2 != h1);
        assertEq(h2, keccak256(abi.encode(DAILY_CAP * 2, MAX_PER_PAYMENT, COOLDOWN, true)));

        vm.prank(owner);
        vault.pausePolicy(agent);
        bytes32 h3 = vault.policyHash(agent);
        assertTrue(h3 != h2);
        assertEq(h3, keccak256(abi.encode(DAILY_CAP * 2, MAX_PER_PAYMENT, COOLDOWN, false)));
    }
}
