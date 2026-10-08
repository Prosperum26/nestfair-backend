-- CreateEnum
CREATE TYPE "HouseRole" AS ENUM ('ADMIN', 'ROOMMATE');

-- CreateTable
CREATE TABLE "houses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "maxMembers" INTEGER NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "inviteExpiresAt" TIMESTAMP(3) NOT NULL,
    "rules" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_members" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "HouseRole" NOT NULL DEFAULT 'ROOMMATE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "house_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "houses_inviteCode_key" ON "houses"("inviteCode");

-- CreateIndex
CREATE INDEX "house_members_houseId_idx" ON "house_members"("houseId");

-- CreateIndex
CREATE INDEX "house_members_userId_idx" ON "house_members"("userId");

-- AddForeignKey
ALTER TABLE "house_members" ADD CONSTRAINT "house_members_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_members" ADD CONSTRAINT "house_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index (viết tay, Prisma không biểu diễn được):
-- mỗi người tối đa 1 membership còn hiệu lực trong một nhà; rời nhà rồi vào lại thì tạo dòng mới.
CREATE UNIQUE INDEX "house_members_active_member_key"
  ON "house_members" ("houseId", "userId")
  WHERE "leftAt" IS NULL;
