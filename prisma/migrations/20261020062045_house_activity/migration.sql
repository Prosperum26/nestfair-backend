-- CreateEnum
CREATE TYPE "ActivityVisibility" AS ENUM ('HOUSE', 'ADMIN_ONLY');

-- CreateTable
CREATE TABLE "house_activities" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" UUID,
    "actorName" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "visibility" "ActivityVisibility" NOT NULL DEFAULT 'HOUSE',
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "house_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "house_activities_houseId_createdAt_idx" ON "house_activities"("houseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "house_activities_houseId_dedupeKey_key" ON "house_activities"("houseId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "house_activities" ADD CONSTRAINT "house_activities_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
