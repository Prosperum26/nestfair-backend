-- Người được giao ban đầu. Ca cũ chưa từng đổi người nên backfill bằng assigneeId.
-- AlterTable: thêm cột cho phép NULL trước để backfill được.
ALTER TABLE "chore_assignments" ADD COLUMN     "originalAssigneeId" UUID;

-- Backfill
UPDATE "chore_assignments" SET "originalAssigneeId" = "assigneeId";

-- Bắt buộc có giá trị từ nay về sau
ALTER TABLE "chore_assignments" ALTER COLUMN "originalAssigneeId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "chore_assignments" ADD CONSTRAINT "chore_assignments_originalAssigneeId_fkey" FOREIGN KEY ("originalAssigneeId") REFERENCES "house_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
