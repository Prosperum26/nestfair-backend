-- CreateEnum
CREATE TYPE "ReceiptScanStatus" AS ENUM ('DRAFT', 'FAILED', 'USED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ocrConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "receipt_scans" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "scannedById" UUID NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "status" "ReceiptScanStatus" NOT NULL,
    "failureReason" TEXT,
    "draftJson" JSONB,
    "model" TEXT,
    "latencyMs" INTEGER,
    "expenseId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_scans_expenseId_key" ON "receipt_scans"("expenseId");

-- CreateIndex
CREATE INDEX "receipt_scans_houseId_createdAt_idx" ON "receipt_scans"("houseId", "createdAt");

-- AddForeignKey
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
