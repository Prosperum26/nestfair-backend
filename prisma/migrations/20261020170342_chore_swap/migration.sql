-- CreateEnum
CREATE TYPE "SwapType" AS ENUM ('EXCHANGE', 'COVER', 'PERMANENT');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Compensation" AS ENUM ('PAYBACK', 'GIFT');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('OPEN', 'PAID', 'FORGIVEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SwapResolution" AS ENUM ('ACCEPTED_BY_TARGET', 'REJECTED_BY_TARGET', 'CANCELLED_BY_REQUESTER', 'EXPIRED_NO_TAKER', 'ESCALATED', 'SLOT_CHANGED', 'REQUESTER_DID_IT', 'MEMBER_LEFT', 'CHORE_DISABLED', 'HOUSE_BREAK', 'ADMIN_OVERRIDE');

-- AlterTable
ALTER TABLE "chore_assignments" ADD COLUMN     "swapRequestId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "chore_swap_requests" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "type" "SwapType" NOT NULL,
    "requesterMemberId" UUID NOT NULL,
    "targetMemberId" UUID,
    "fromAssignmentId" UUID,
    "toAssignmentId" UUID,
    "compensation" "Compensation",
    "rewardNote" VARCHAR(100),
    "rewardAmount" INTEGER,
    "reason" VARCHAR(200),
    "note" VARCHAR(200),
    "status" "SwapStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" "SwapResolution",
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "acceptIdemKey" TEXT,
    "rootRequestId" UUID NOT NULL,
    "escalationChoice" TEXT,
    "escalationDeadline" TIMESTAMP(3),
    "fromWeightSnapshot" INTEGER NOT NULL,
    "toWeightSnapshot" INTEGER,
    "offsetDebtId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chore_swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap_locks" (
    "assignmentId" UUID NOT NULL,
    "swapRequestId" UUID NOT NULL,

    CONSTRAINT "swap_locks_pkey" PRIMARY KEY ("assignmentId")
);

-- CreateTable
CREATE TABLE "chore_debts" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "debtorMemberId" UUID NOT NULL,
    "creditorMemberId" UUID NOT NULL,
    "swapRequestId" UUID NOT NULL,
    "coverAssignmentId" UUID NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" "DebtStatus" NOT NULL DEFAULT 'OPEN',
    "closeReason" TEXT,
    "pickOpensAt" TIMESTAMP(3),
    "pickDeadlineAt" TIMESTAMP(3),
    "pickAttempts" INTEGER NOT NULL DEFAULT 0,
    "paybackAssignmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "chore_debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_swaps" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "swapRequestId" UUID NOT NULL,
    "userAMemberId" UUID NOT NULL,
    "userBMemberId" UUID NOT NULL,
    "effectiveWeekStart" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "failReason" TEXT,

    CONSTRAINT "rotation_swaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chore_swap_requests_houseId_status_expiresAt_idx" ON "chore_swap_requests"("houseId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "chore_swap_requests_rootRequestId_idx" ON "chore_swap_requests"("rootRequestId");

-- CreateIndex
CREATE INDEX "chore_debts_debtorMemberId_status_idx" ON "chore_debts"("debtorMemberId", "status");

-- CreateIndex
CREATE INDEX "chore_debts_creditorMemberId_status_idx" ON "chore_debts"("creditorMemberId", "status");

-- Cấu trúc yêu cầu theo loại
ALTER TABLE "chore_swap_requests" ADD CONSTRAINT "swap_shape" CHECK (
     ("type" = 'EXCHANGE'  AND "fromAssignmentId" IS NOT NULL AND "toAssignmentId" IS NOT NULL)
  OR ("type" = 'COVER'     AND "fromAssignmentId" IS NOT NULL AND "toAssignmentId" IS NULL AND "compensation" IS NOT NULL)
  OR ("type" = 'PERMANENT' AND "fromAssignmentId" IS NULL AND "toAssignmentId" IS NULL)
);

-- Quà chỉ khi GIFT, trong khoảng 1.000–500.000đ
ALTER TABLE "chore_swap_requests" ADD CONSTRAINT "swap_reward" CHECK (
  "rewardAmount" IS NULL OR ("compensation" = 'GIFT' AND "rewardAmount" BETWEEN 1000 AND 500000)
);

-- Không gửi cho chính mình
ALTER TABLE "chore_swap_requests" ADD CONSTRAINT "swap_not_self" CHECK (
  "targetMemberId" IS NULL OR "targetMemberId" <> "requesterMemberId"
);

ALTER TABLE "chore_debts" ADD CONSTRAINT "debt_weight" CHECK ("weight" >= 1);
