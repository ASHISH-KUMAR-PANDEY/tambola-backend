-- AlterTable
ALTER TABLE "PromotionalBanner" ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "s3Key" TEXT,
ADD COLUMN     "uploadedBy" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "YouTubeEmbed" ADD COLUMN     "embedId" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "YouTubeLiveStream" ADD COLUMN     "videoUrl" TEXT;
