-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ORGANIZER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'PLAYER';

-- CreateTable
CREATE TABLE "PromotionalBanner" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "altText" TEXT,
    "linkUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionalBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeEmbed" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeEmbed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeLiveStream" (
    "id" TEXT NOT NULL,
    "embedId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeLiveStream_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionalBanner_isActive_displayOrder_idx" ON "PromotionalBanner"("isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeEmbed_videoId_key" ON "YouTubeEmbed"("videoId");

-- CreateIndex
CREATE INDEX "YouTubeEmbed_isActive_displayOrder_idx" ON "YouTubeEmbed"("isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeLiveStream_embedId_key" ON "YouTubeLiveStream"("embedId");

-- CreateIndex
CREATE INDEX "YouTubeLiveStream_isActive_idx" ON "YouTubeLiveStream"("isActive");
