-- DropIndex
DROP INDEX "SoloGame_userId_weekId_key";

-- DropIndex
DROP INDEX "SoloWeeklyWinner_weekId_category_key";

-- AlterTable: Add gameNumber to SoloGame
ALTER TABLE "SoloGame" ADD COLUMN "gameNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: Add Game 2 video config fields to SoloWeek
ALTER TABLE "SoloWeek" ADD COLUMN "game2ConfiguredAt" TIMESTAMP(3),
ADD COLUMN "game2ConfiguredBy" TEXT,
ADD COLUMN "game2NumberSequence" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "game2NumberTimestamps" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
ADD COLUMN "game2VideoId" TEXT,
ADD COLUMN "game2VideoStartTime" DOUBLE PRECISION,
ADD COLUMN "game2VideoUrl" TEXT;

-- AlterTable: Add gameNumber to SoloWeeklyWinner
ALTER TABLE "SoloWeeklyWinner" ADD COLUMN "gameNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex: New unique constraint including gameNumber
CREATE UNIQUE INDEX "SoloGame_userId_weekId_gameNumber_key" ON "SoloGame"("userId", "weekId", "gameNumber");

-- CreateIndex: New unique constraint including gameNumber
CREATE UNIQUE INDEX "SoloWeeklyWinner_weekId_category_gameNumber_key" ON "SoloWeeklyWinner"("weekId", "category", "gameNumber");
