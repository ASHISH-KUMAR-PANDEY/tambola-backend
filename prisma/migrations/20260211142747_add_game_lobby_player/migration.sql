-- CreateTable
CREATE TABLE "GameLobbyPlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameLobbyPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameLobbyPlayer_gameId_idx" ON "GameLobbyPlayer"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "GameLobbyPlayer_gameId_userId_key" ON "GameLobbyPlayer"("gameId", "userId");

-- AddForeignKey
ALTER TABLE "GameLobbyPlayer" ADD CONSTRAINT "GameLobbyPlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
