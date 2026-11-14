-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('WRITE_OFF', 'TRANSFER');

-- CreateTable
CREATE TABLE "balance_adjustments" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "toUserId" UUID,
    "amount" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_adjustment_lines" (
    "id" UUID NOT NULL,
    "adjustmentId" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "balance_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "balance_adjustments_houseId_createdAt_idx" ON "balance_adjustments"("houseId", "createdAt");

-- CreateIndex
CREATE INDEX "balance_adjustment_lines_houseId_idx" ON "balance_adjustment_lines"("houseId");

-- AddForeignKey
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_adjustment_lines" ADD CONSTRAINT "balance_adjustment_lines_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "balance_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ràng buộc viết tay: TRANSFER phải có người nhận, WRITE_OFF thì không; số dư được xử lý khác 0; mỗi dòng > 0.
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_kind_to_check"
  CHECK (("kind" = 'TRANSFER') = ("toUserId" IS NOT NULL));
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "balance_adjustment_lines" ADD CONSTRAINT "balance_adjustment_lines_amount_check" CHECK ("amount" > 0);
