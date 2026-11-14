-- CreateEnum
CREATE TYPE "ChoreFrequency" AS ENUM ('WEEKLY');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('AUTO', 'SHUFFLE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('TODO', 'PENDING_VERIFY', 'DONE', 'REJECTED', 'MISSED');

-- CreateTable
CREATE TABLE "chores" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "frequency" "ChoreFrequency" NOT NULL DEFAULT 'WEEKLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chore_assignments" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "choreId" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "weekKey" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "source" "AssignmentSource" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'TODO',
    "proofImageUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chore_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chores_houseId_idx" ON "chores"("houseId");

-- CreateIndex
CREATE INDEX "chore_assignments_houseId_weekKey_idx" ON "chore_assignments"("houseId", "weekKey");

-- CreateIndex
CREATE INDEX "chore_assignments_assigneeId_idx" ON "chore_assignments"("assigneeId");

-- CreateIndex
CREATE INDEX "chore_assignments_status_dueAt_idx" ON "chore_assignments"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "chore_assignments_choreId_weekKey_key" ON "chore_assignments"("choreId", "weekKey");

-- AddForeignKey
ALTER TABLE "chores" ADD CONSTRAINT "chores_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_assignments" ADD CONSTRAINT "chore_assignments_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_assignments" ADD CONSTRAINT "chore_assignments_choreId_fkey" FOREIGN KEY ("choreId") REFERENCES "chores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_assignments" ADD CONSTRAINT "chore_assignments_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "house_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_assignments" ADD CONSTRAINT "chore_assignments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "house_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chores" ADD CONSTRAINT "chores_weight_check" CHECK ("weight" BETWEEN 1 AND 5);
