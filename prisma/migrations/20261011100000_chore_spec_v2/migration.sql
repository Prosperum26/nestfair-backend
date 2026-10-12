-- Issue #4 v2: lịch theo ngày, WeekSchedule, vắng mặt / nghỉ nhà, nhật ký.
-- Dữ liệu cũ (1 ca / việc / tuần, hạn Chủ Nhật 23:59) được backfill để không mất.

-- CreateEnum
CREATE TYPE "RotationMode" AS ENUM ('WEEK_BLOCK', 'PER_OCCURRENCE');
CREATE TYPE "ScheduleStatus" AS ENUM ('PUBLISHED', 'LOCKED', 'EMPTY');
CREATE TYPE "GeneratedBy" AS ENUM ('CRON', 'CATCHUP', 'USER', 'ADMIN_REROLL');
CREATE TYPE "VerifyMode" AS ENUM ('PEER', 'AUTO_APPROVED', 'SELF_ATTESTED', 'ADMIN_OVERRIDE');

-- AlterEnum AssignmentSource: AUTO / SHUFFLE cũ đều là lịch xoay vòng bình thường.
BEGIN;
CREATE TYPE "AssignmentSource_new" AS ENUM ('ROTATION', 'SWAP', 'COVER', 'PAYBACK', 'WHEEL', 'REASSIGN');
ALTER TABLE "chore_assignments" ALTER COLUMN "source" TYPE "AssignmentSource_new"
  USING (CASE "source"::text WHEN 'AUTO' THEN 'ROTATION' WHEN 'SHUFFLE' THEN 'ROTATION' ELSE "source"::text END::"AssignmentSource_new");
ALTER TYPE "AssignmentSource" RENAME TO "AssignmentSource_old";
ALTER TYPE "AssignmentSource_new" RENAME TO "AssignmentSource";
DROP TYPE "public"."AssignmentSource_old";
COMMIT;

-- AlterEnum (các giá trị mới chưa được dùng trong migration này)
ALTER TYPE "AssignmentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "AssignmentStatus" ADD VALUE 'UNASSIGNED';
ALTER TYPE "ChoreFrequency" ADD VALUE 'DAILY';
ALTER TYPE "ChoreFrequency" ADD VALUE 'ADHOC';

-- DropIndex
DROP INDEX "chore_assignments_assigneeId_idx";
DROP INDEX "chore_assignments_choreId_weekKey_key";
DROP INDEX "chore_assignments_houseId_weekKey_idx";

-- AlterTable houses
ALTER TABLE "houses" ADD COLUMN "choreGraceHours" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "maxSlotsPerPersonPerDay" INTEGER NOT NULL DEFAULT 2;

-- AlterTable chores: việc cũ lặp 1 lần / tuần, hạn Chủ Nhật 23:59.
ALTER TABLE "chores" ADD COLUMN "dueTime" TEXT NOT NULL DEFAULT '21:00',
ADD COLUMN "occurrenceGap" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "recurrenceDays" INTEGER[],
ADD COLUMN "rotationMode" "RotationMode" NOT NULL DEFAULT 'WEEK_BLOCK';
UPDATE "chores" SET "recurrenceDays" = ARRAY[7], "dueTime" = '23:59';

-- AlterTable chore_assignments: thêm cột nullable, backfill rồi mới đặt NOT NULL.
ALTER TABLE "chore_assignments" ADD COLUMN "checkinKey" TEXT,
ADD COLUMN "disputed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isLate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "occurrenceDate" DATE,
ADD COLUMN "proofHash" TEXT,
ADD COLUMN "rejectCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "scheduleId" UUID,
ADD COLUMN "slotIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "titleSnapshot" TEXT,
ADD COLUMN "verifyMode" "VerifyMode",
ADD COLUMN "weekStart" DATE,
ADD COLUMN "weightSnapshot" INTEGER,
ALTER COLUMN "assigneeId" DROP NOT NULL,
ALTER COLUMN "originalAssigneeId" DROP NOT NULL;

UPDATE "chore_assignments" a
SET "occurrenceDate" = ((a."dueAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    "titleSnapshot" = c."title",
    "weightSnapshot" = c."weight"
FROM "chores" c
WHERE c."id" = a."choreId";

UPDATE "chore_assignments" SET "weekStart" = date_trunc('week', "occurrenceDate"::timestamp)::date;

ALTER TABLE "chore_assignments" ALTER COLUMN "occurrenceDate" SET NOT NULL,
ALTER COLUMN "weekStart" SET NOT NULL,
ALTER COLUMN "titleSnapshot" SET NOT NULL,
ALTER COLUMN "weightSnapshot" SET NOT NULL;

-- CreateTable
CREATE TABLE "week_schedules" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekKey" TEXT NOT NULL,
    "status" "ScheduleStatus" NOT NULL,
    "generatedBy" "GeneratedBy" NOT NULL,
    "seed" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL,
    "fenceWeeksApplied" INTEGER NOT NULL,
    "relaxLevel" INTEGER NOT NULL DEFAULT 0,
    "relaxed" BOOLEAN NOT NULL DEFAULT false,
    "reasons" TEXT[],
    "rerollCount" INTEGER NOT NULL DEFAULT 0,
    "loadSnapshot" JSONB NOT NULL,
    "algoVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "week_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "member_absences" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_absences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "house_breaks" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "house_breaks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chore_audit_logs" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "assignmentId" UUID,
    "scheduleId" UUID,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chore_audit_logs_pkey" PRIMARY KEY ("id")
);

-- Backfill: mỗi (nhà, tuần) đang có ca được một WeekSchedule "legacy" đã khóa.
INSERT INTO "week_schedules"
  ("id", "houseId", "weekStart", "weekKey", "status", "generatedBy", "seed", "attempts",
   "fenceWeeksApplied", "relaxLevel", "relaxed", "reasons", "rerollCount", "loadSnapshot", "algoVersion")
SELECT gen_random_uuid(), "houseId", "weekStart", MIN("weekKey"), 'LOCKED', 'CRON', 0, 0,
       3, 0, false, ARRAY[]::text[], 0, '{}'::jsonb, 'legacy'
FROM "chore_assignments"
GROUP BY "houseId", "weekStart";

UPDATE "chore_assignments" a
SET "scheduleId" = s."id"
FROM "week_schedules" s
WHERE s."houseId" = a."houseId" AND s."weekStart" = a."weekStart";

-- CreateIndex
CREATE UNIQUE INDEX "week_schedules_houseId_weekStart_key" ON "week_schedules"("houseId", "weekStart");
CREATE INDEX "member_absences_houseId_startDate_endDate_idx" ON "member_absences"("houseId", "startDate", "endDate");
CREATE INDEX "house_breaks_houseId_startDate_endDate_idx" ON "house_breaks"("houseId", "startDate", "endDate");
CREATE INDEX "chore_audit_logs_houseId_createdAt_idx" ON "chore_audit_logs"("houseId", "createdAt");
CREATE INDEX "chore_assignments_houseId_weekStart_idx" ON "chore_assignments"("houseId", "weekStart");
CREATE INDEX "chore_assignments_houseId_proofHash_idx" ON "chore_assignments"("houseId", "proofHash");
CREATE INDEX "chore_assignments_assigneeId_choreId_weekStart_idx" ON "chore_assignments"("assigneeId", "choreId", "weekStart");
CREATE UNIQUE INDEX "chore_assignments_choreId_occurrenceDate_slotIndex_key" ON "chore_assignments"("choreId", "occurrenceDate", "slotIndex");

-- AddForeignKey
ALTER TABLE "week_schedules" ADD CONSTRAINT "week_schedules_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chore_assignments" ADD CONSTRAINT "chore_assignments_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "week_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "house_breaks" ADD CONSTRAINT "house_breaks_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chore_audit_logs" ADD CONSTRAINT "chore_audit_logs_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ràng buộc SQL tay
ALTER TABLE "chores" ADD CONSTRAINT "chores_recurrence_days_check" CHECK ("recurrenceDays" <@ ARRAY[1,2,3,4,5,6,7]);
ALTER TABLE "chores" ADD CONSTRAINT "chores_due_time_check" CHECK ("dueTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "chores" ADD CONSTRAINT "chores_occurrence_gap_check" CHECK ("occurrenceGap" >= 1);
ALTER TABLE "houses" ADD CONSTRAINT "houses_chore_grace_check" CHECK ("choreGraceHours" BETWEEN 1 AND 24);
ALTER TABLE "houses" ADD CONSTRAINT "houses_max_slots_check" CHECK ("maxSlotsPerPersonPerDay" BETWEEN 1 AND 6);
ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_range_check" CHECK ("endDate" >= "startDate");
ALTER TABLE "house_breaks" ADD CONSTRAINT "house_breaks_range_check" CHECK ("endDate" >= "startDate");
ALTER TABLE "week_schedules" ADD CONSTRAINT "week_schedules_monday_check" CHECK (EXTRACT(ISODOW FROM "weekStart") = 1);
ALTER TABLE "chore_assignments" ADD CONSTRAINT "chore_assignments_week_monday_check" CHECK (EXTRACT(ISODOW FROM "weekStart") = 1);
