-- CreateEnum
CREATE TYPE "AssistantRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AssistantCategory" AS ENUM ('TIP', 'INCIDENT', 'EMOTIONAL', 'REMINDER', 'OTHER');

-- CreateEnum
CREATE TYPE "ReminderSource" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "assistantConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "content" TEXT NOT NULL,
    "category" "AssistantCategory",
    "actionsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "source" "ReminderSource" NOT NULL,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_messages_userId_houseId_createdAt_idx" ON "assistant_messages"("userId", "houseId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_messages_userId_threadId_createdAt_idx" ON "assistant_messages"("userId", "threadId", "createdAt");

-- CreateIndex
CREATE INDEX "reminders_userId_remindAt_idx" ON "reminders"("userId", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_userId_dedupeKey_key" ON "reminders"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial index (viết tay, Prisma không biểu diễn được): cron quét nhắc chưa gửi chỉ đụng các dòng sentAt IS NULL.
CREATE INDEX "reminders_remindAt_sentAt_idx" ON "reminders"("remindAt") WHERE "sentAt" IS NULL;
