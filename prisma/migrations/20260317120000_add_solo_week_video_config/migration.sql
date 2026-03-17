-- AlterTable: Add video configuration fields to SoloWeek
ALTER TABLE "SoloWeek" ADD COLUMN "videoUrl" TEXT;
ALTER TABLE "SoloWeek" ADD COLUMN "videoId" TEXT;
ALTER TABLE "SoloWeek" ADD COLUMN "numberSequence" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "SoloWeek" ADD COLUMN "numberTimestamps" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[];
ALTER TABLE "SoloWeek" ADD COLUMN "videoStartTime" DOUBLE PRECISION;
ALTER TABLE "SoloWeek" ADD COLUMN "numberInterval" DOUBLE PRECISION;
ALTER TABLE "SoloWeek" ADD COLUMN "configuredAt" TIMESTAMP(3);
ALTER TABLE "SoloWeek" ADD COLUMN "configuredBy" TEXT;
