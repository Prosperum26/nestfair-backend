-- CreateEnum
CREATE TYPE "WheelStatus" AS ENUM ('SPINNING', 'REVEALED', 'VOIDED');

-- AlterTable
ALTER TABLE "chores" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "lucky_wheel_logs" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "spunById" UUID NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "participantIds" UUID[],
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "slices" UUID[],
    "selectedUserId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "seed" INTEGER NOT NULL,
    "landingIndex" INTEGER NOT NULL,
    "status" "WheelStatus" NOT NULL DEFAULT 'SPINNING',
    "spunAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 6000,
    "revealAt" TIMESTAMP(3) NOT NULL,
    "voidedById" UUID,
    "voidReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lucky_wheel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lucky_wheel_logs_assignmentId_key" ON "lucky_wheel_logs"("assignmentId");

-- CreateIndex
CREATE INDEX "lucky_wheel_logs_houseId_spunAt_idx" ON "lucky_wheel_logs"("houseId", "spunAt");

-- CreateIndex
CREATE INDEX "lucky_wheel_logs_status_revealAt_idx" ON "lucky_wheel_logs"("status", "revealAt");

-- CreateIndex
CREATE UNIQUE INDEX "lucky_wheel_logs_houseId_spunById_idempotencyKey_key" ON "lucky_wheel_logs"("houseId", "spunById", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "lucky_wheel_logs" ADD CONSTRAINT "lucky_wheel_logs_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lucky_wheel_logs" ADD CONSTRAINT "lucky_wheel_logs_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "chore_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
