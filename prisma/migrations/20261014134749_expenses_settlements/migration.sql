-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FOOD', 'RENT', 'ELECTRICITY', 'WATER', 'INTERNET', 'SUPPLIES', 'GIFT', 'OTHER');

-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('EQUAL', 'CUSTOM', 'EXACT', 'ITEMIZED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "payerId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "splitType" "SplitType" NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "receiptImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_splits" (
    "id" UUID NOT NULL,
    "expenseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "allocatedAmount" INTEGER NOT NULL,

    CONSTRAINT "expense_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "proofUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_houseId_spentAt_idx" ON "expenses"("houseId", "spentAt");

-- CreateIndex
CREATE INDEX "expenses_payerId_idx" ON "expenses"("payerId");

-- CreateIndex
CREATE INDEX "expense_splits_userId_idx" ON "expense_splits"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_splits_expenseId_userId_key" ON "expense_splits"("expenseId", "userId");

-- CreateIndex
CREATE INDEX "settlements_houseId_status_idx" ON "settlements"("houseId", "status");

-- CreateIndex
CREATE INDEX "settlements_houseId_createdAt_idx" ON "settlements"("houseId", "createdAt");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ràng buộc SQL tay
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_total_amount_check" CHECK ("totalAmount" > 0);
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_amount_check" CHECK ("allocatedAmount" >= 0);
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amount_check" CHECK ("amount" > 0);
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_parties_check" CHECK ("fromUserId" <> "toUserId");
-- confirmedAt có giá trị khi và chỉ khi status = CONFIRMED.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_confirmed_at_check" CHECK (("status" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL));

-- Mỗi cặp (người chuyển, người nhận) trong một nhà chỉ có một báo "đã chuyển" đang chờ xác nhận (chống báo trùng, bấm đúp).
CREATE UNIQUE INDEX "settlements_pending_pair_key" ON "settlements"("houseId", "fromUserId", "toUserId") WHERE "status" = 'PENDING';
