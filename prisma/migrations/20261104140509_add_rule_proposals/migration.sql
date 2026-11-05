-- CreateEnum
CREATE TYPE "RuleProposalKind" AS ENUM ('ADD', 'EDIT', 'REMOVE');

-- CreateEnum
CREATE TYPE "RuleProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "rule_proposals" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "proposerId" UUID NOT NULL,
    "kind" "RuleProposalKind" NOT NULL,
    "targetText" TEXT,
    "content" TEXT,
    "reason" TEXT,
    "status" "RuleProposalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rule_proposals_houseId_status_createdAt_idx" ON "rule_proposals"("houseId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "rule_proposals" ADD CONSTRAINT "rule_proposals_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_proposals" ADD CONSTRAINT "rule_proposals_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
