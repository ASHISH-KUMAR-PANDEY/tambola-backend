-- CreateTable
CREATE TABLE "RegistrationCard" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "targetDateTime" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationCard_isActive_idx" ON "RegistrationCard"("isActive");
