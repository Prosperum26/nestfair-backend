-- AlterTable
ALTER TABLE "chore_swap_requests" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "createIdemKey" TEXT,
ADD COLUMN     "fromVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rejectReason" VARCHAR(100),
ADD COLUMN     "toVersion" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "chore_swap_requests_requesterMemberId_createIdemKey_key" ON "chore_swap_requests"("requesterMemberId", "createIdemKey");

