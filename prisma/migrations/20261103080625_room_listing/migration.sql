-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ListingCloseReason" AS ENUM ('FULL', 'MANUAL');

-- CreateEnum
CREATE TYPE "GenderWanted" AS ENUM ('MALE', 'FEMALE', 'ANY');

-- CreateEnum
CREATE TYPE "ListingPhotoCategory" AS ENUM ('BEDROOM', 'BATHROOM', 'LIVING');

-- CreateTable
CREATE TABLE "room_listings" (
    "id" UUID NOT NULL,
    "houseId" UUID NOT NULL,
    "slug" VARCHAR(8) NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "closeReason" "ListingCloseReason",
    "locationText" VARCHAR(120) NOT NULL,
    "genderWanted" "GenderWanted" NOT NULL DEFAULT 'ANY',
    "rentPerMonth" INTEGER NOT NULL,
    "otherFees" JSONB NOT NULL DEFAULT '[]',
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "roommateExpectations" VARCHAR(500) NOT NULL DEFAULT '',
    "contactPhone" VARCHAR(10) NOT NULL,
    "showChoreSchedule" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_photos" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "category" "ListingPhotoCategory" NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_listings_houseId_key" ON "room_listings"("houseId");

-- CreateIndex
CREATE UNIQUE INDEX "room_listings_slug_key" ON "room_listings"("slug");

-- CreateIndex
CREATE INDEX "listing_photos_listingId_category_sortOrder_idx" ON "listing_photos"("listingId", "category", "sortOrder");

-- AddForeignKey
ALTER TABLE "room_listings" ADD CONSTRAINT "room_listings_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "room_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ràng buộc SQL tay
ALTER TABLE "room_listings" ADD CONSTRAINT "room_listings_slug_check" CHECK ("slug" ~ '^[0-9A-Za-z]{8}$');
ALTER TABLE "room_listings" ADD CONSTRAINT "room_listings_rent_check" CHECK ("rentPerMonth" > 0 AND "rentPerMonth" <= 50000000);
ALTER TABLE "room_listings" ADD CONSTRAINT "room_listings_phone_check" CHECK ("contactPhone" ~ '^0[0-9]{9}$');
-- closeReason có giá trị khi và chỉ khi status = CLOSED.
ALTER TABLE "room_listings" ADD CONSTRAINT "room_listings_close_reason_check" CHECK (("status" = 'CLOSED') = ("closeReason" IS NOT NULL));
ALTER TABLE "room_listings" ADD CONSTRAINT "room_listings_other_fees_check" CHECK (jsonb_typeof("otherFees") = 'array');
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_sort_order_check" CHECK ("sortOrder" >= 0);
