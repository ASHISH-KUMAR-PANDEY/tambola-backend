-- AlterTable: Make email, password, and name nullable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "name" DROP NOT NULL;

-- AlterTable: Add mobile fields
ALTER TABLE "User" ADD COLUMN "mobileNumber" TEXT;
ALTER TABLE "User" ADD COLUMN "countryCode" TEXT DEFAULT '+91';

-- CreateIndex: Add unique constraint on mobileNumber
CREATE UNIQUE INDEX "User_mobileNumber_key" ON "User"("mobileNumber");

-- CreateIndex: Add index on mobileNumber for faster lookups
CREATE INDEX "User_mobileNumber_idx" ON "User"("mobileNumber");
