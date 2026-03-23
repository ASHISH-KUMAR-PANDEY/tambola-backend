-- CreateEnum
CREATE TYPE "SoloGameStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SoloWeekStatus" AS ENUM ('ACTIVE', 'FINALIZED');

-- CreateTable
CREATE TABLE "SoloWeek" (
    "id" TEXT NOT NULL,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "weekEndDate" TIMESTAMP(3) NOT NULL,
    "status" "SoloWeekStatus" NOT NULL DEFAULT 'ACTIVE',
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoloWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoloGame" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "ticket" JSONB NOT NULL,
    "numberSequence" INTEGER[],
    "markedNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" "SoloGameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoloGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoloClaim" (
    "id" TEXT NOT NULL,
    "soloGameId" TEXT NOT NULL,
    "category" "WinCategory" NOT NULL,
    "numberCountAtClaim" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoloClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoloWeeklyWinner" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "category" "WinCategory" NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "numberCountAtClaim" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoloWeeklyWinner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoloWeek_weekStartDate_key" ON "SoloWeek"("weekStartDate");

-- CreateIndex
CREATE INDEX "SoloWeek_status_idx" ON "SoloWeek"("status");

-- CreateIndex
CREATE INDEX "SoloGame_userId_idx" ON "SoloGame"("userId");

-- CreateIndex
CREATE INDEX "SoloGame_weekId_idx" ON "SoloGame"("weekId");

-- CreateIndex
CREATE INDEX "SoloGame_status_idx" ON "SoloGame"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SoloGame_userId_weekId_key" ON "SoloGame"("userId", "weekId");

-- CreateIndex
CREATE INDEX "SoloClaim_soloGameId_idx" ON "SoloClaim"("soloGameId");

-- CreateIndex
CREATE INDEX "SoloClaim_category_numberCountAtClaim_idx" ON "SoloClaim"("category", "numberCountAtClaim");

-- CreateIndex
CREATE UNIQUE INDEX "SoloClaim_soloGameId_category_key" ON "SoloClaim"("soloGameId", "category");

-- CreateIndex
CREATE INDEX "SoloWeeklyWinner_weekId_idx" ON "SoloWeeklyWinner"("weekId");

-- CreateIndex
CREATE UNIQUE INDEX "SoloWeeklyWinner_weekId_category_key" ON "SoloWeeklyWinner"("weekId", "category");

-- AddForeignKey
ALTER TABLE "SoloGame" ADD CONSTRAINT "SoloGame_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "SoloWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoloClaim" ADD CONSTRAINT "SoloClaim_soloGameId_fkey" FOREIGN KEY ("soloGameId") REFERENCES "SoloGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoloWeeklyWinner" ADD CONSTRAINT "SoloWeeklyWinner_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "SoloWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
