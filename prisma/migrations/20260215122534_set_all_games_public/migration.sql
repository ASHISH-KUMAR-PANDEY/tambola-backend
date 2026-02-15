-- Update existing games to be public and change default to true
UPDATE "Game" SET "isPublic" = true WHERE "isPublic" = false;
ALTER TABLE "Game" ALTER COLUMN "isPublic" SET DEFAULT true;
