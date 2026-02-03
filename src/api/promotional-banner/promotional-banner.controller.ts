import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { prisma } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { uploadToS3, deleteFromS3, extractS3Key, isS3Configured, generatePresignedUploadUrl } from '../../services/s3.service.js';
import { uploadToLocal, deleteFromLocal } from '../../services/localStorage.service.js';
import { logger } from '../../utils/logger.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ASPECT_RATIO = 16 / 9;
const ASPECT_RATIO_TOLERANCE = 0.01; // Allow 1% tolerance

export async function uploadBanner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;

    // Get file from multipart form data
    const data = await request.file();

    if (!data) {
      throw new AppError('NO_FILE', 'No file uploaded', 400);
    }

    const buffer = await data.toBuffer();

    // Check file size
    if (buffer.length > MAX_FILE_SIZE) {
      throw new AppError('FILE_TOO_LARGE', 'File size exceeds 5MB limit', 400);
    }

    // Validate image and get dimensions using sharp
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (error) {
      throw new AppError('INVALID_IMAGE', 'Invalid image file', 400);
    }

    const { width, height } = metadata;

    if (!width || !height) {
      throw new AppError('INVALID_IMAGE', 'Could not determine image dimensions', 400);
    }

    // Validate 16:9 aspect ratio
    const actualRatio = width / height;
    const ratioDiff = Math.abs(actualRatio - ASPECT_RATIO);

    if (ratioDiff > ASPECT_RATIO_TOLERANCE) {
      throw new AppError(
        'INVALID_ASPECT_RATIO',
        `Image must have 16:9 aspect ratio. Current ratio: ${actualRatio.toFixed(2)}:1`,
        400
      );
    }

    // Check if S3 is configured, otherwise use local storage
    const useS3 = isS3Configured();
    let imageUrl: string;
    let s3Key: string | null = null;
    let storageType: 'S3' | 'LOCAL';

    if (useS3) {
      logger.info('Using S3 storage for banner upload');
      imageUrl = await uploadToS3(buffer, data.filename, data.mimetype);
      s3Key = extractS3Key(imageUrl);
      storageType = 'S3';
    } else {
      logger.info('S3 not configured, using local storage for banner upload');
      imageUrl = await uploadToLocal(buffer, data.filename, data.mimetype);
      storageType = 'LOCAL';
    }

    // Delete old banner if exists
    const existingBanner = await prisma.promotionalBanner.findFirst();
    if (existingBanner) {
      try {
        if (existingBanner.s3Key) {
          // Old banner was stored in S3
          await deleteFromS3(existingBanner.s3Key);
        } else {
          // Old banner was stored locally
          await deleteFromLocal(existingBanner.imageUrl);
        }
      } catch (error) {
        logger.error({ error }, 'Failed to delete old banner');
      }
      await prisma.promotionalBanner.delete({
        where: { id: existingBanner.id },
      });
    }

    // Save new banner to database
    const banner = await prisma.promotionalBanner.create({
      data: {
        imageUrl,
        s3Key: s3Key || null,
        uploadedBy: authReq.user.userId,
        width,
        height,
        fileSize: buffer.length,
      },
    });

    await reply.status(201).send({
      id: banner.id,
      imageUrl: banner.imageUrl,
      width: banner.width,
      height: banner.height,
      fileSize: banner.fileSize,
      createdAt: banner.createdAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Upload banner error:', error);
    throw new AppError('UPLOAD_FAILED', 'Failed to upload promotional banner', 500);
  }
}

export async function getCurrentBanner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const banner = await prisma.promotionalBanner.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!banner) {
      await reply.send({ banner: null });
      return;
    }

    await reply.send({
      banner: {
        id: banner.id,
        imageUrl: banner.imageUrl,
        width: banner.width,
        height: banner.height,
        createdAt: banner.createdAt,
      },
    });
  } catch (error) {
    throw new AppError('GET_BANNER_FAILED', 'Failed to get promotional banner', 500);
  }
}

export async function deleteBanner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const banner = await prisma.promotionalBanner.findFirst();

    if (!banner) {
      throw new AppError('BANNER_NOT_FOUND', 'No promotional banner found', 404);
    }

    // Delete from storage (S3 or local)
    try {
      if (banner.s3Key) {
        // Banner is stored in S3
        await deleteFromS3(banner.s3Key);
      } else {
        // Banner is stored locally
        await deleteFromLocal(banner.imageUrl);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to delete banner from storage');
    }

    // Delete from database
    await prisma.promotionalBanner.delete({
      where: { id: banner.id },
    });

    await reply.status(204).send();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('DELETE_BANNER_FAILED', 'Failed to delete promotional banner', 500);
  }
}

/**
 * Get presigned URL for direct browser-to-S3 upload
 */
interface PresignedUrlBody {
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export async function getPresignedUploadUrl(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const body = request.body as PresignedUrlBody;
    const { fileName, fileSize, mimeType } = body;

    // Validate input
    if (!fileName || !fileSize || !mimeType) {
      throw new AppError('INVALID_INPUT', 'fileName, fileSize, and mimeType are required', 400);
    }

    // Validate file size (5MB max)
    if (fileSize > MAX_FILE_SIZE) {
      throw new AppError('FILE_TOO_LARGE', 'File size exceeds 5MB limit', 400);
    }

    // Validate MIME type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(mimeType)) {
      throw new AppError(
        'INVALID_MIME_TYPE',
        'Only JPEG, PNG, and WebP images are allowed',
        400
      );
    }

    // Check if S3 is configured
    if (!isS3Configured()) {
      throw new AppError(
        'S3_NOT_CONFIGURED',
        'S3 storage is not configured. Please contact administrator.',
        503
      );
    }

    // Generate presigned URL
    const { presignedUrl, s3Key, publicUrl } = await generatePresignedUploadUrl(
      fileName,
      mimeType
    );

    await reply.send({
      presignedUrl,
      s3Key,
      publicUrl,
      expiresIn: 900, // 15 minutes in seconds
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to generate presigned upload URL');
    throw new AppError('PRESIGNED_URL_FAILED', 'Failed to generate presigned upload URL', 500);
  }
}

/**
 * Validate and save banner after direct S3 upload
 */
interface ValidateUploadBody {
  s3Key: string;
  publicUrl: string;
  fileSize: number;
}

export async function validateUploadedBanner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const body = request.body as ValidateUploadBody;
    const { s3Key, publicUrl, fileSize } = body;

    // Validate input
    if (!s3Key || !publicUrl || !fileSize) {
      throw new AppError('INVALID_INPUT', 's3Key, publicUrl, and fileSize are required', 400);
    }

    // Download the image from S3 to validate it
    const response = await fetch(publicUrl);
    if (!response.ok) {
      throw new AppError('DOWNLOAD_FAILED', 'Failed to download image from S3', 500);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate image and get dimensions using sharp
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (error) {
      // Invalid image, delete from S3
      try {
        await deleteFromS3(s3Key);
      } catch (deleteError) {
        logger.error({ error: deleteError }, 'Failed to delete invalid image from S3');
      }
      throw new AppError('INVALID_IMAGE', 'Invalid image file', 400);
    }

    const { width, height } = metadata;

    if (!width || !height) {
      // Delete invalid image from S3
      try {
        await deleteFromS3(s3Key);
      } catch (deleteError) {
        logger.error({ error: deleteError }, 'Failed to delete invalid image from S3');
      }
      throw new AppError('INVALID_IMAGE', 'Could not determine image dimensions', 400);
    }

    // Validate 16:9 aspect ratio
    const actualRatio = width / height;
    const ratioDiff = Math.abs(actualRatio - ASPECT_RATIO);

    if (ratioDiff > ASPECT_RATIO_TOLERANCE) {
      // Delete image with wrong aspect ratio from S3
      try {
        await deleteFromS3(s3Key);
      } catch (deleteError) {
        logger.error({ error: deleteError }, 'Failed to delete image from S3');
      }
      throw new AppError(
        'INVALID_ASPECT_RATIO',
        `Image must have 16:9 aspect ratio. Current ratio: ${actualRatio.toFixed(2)}:1`,
        400
      );
    }

    // Delete old banner if exists
    const existingBanner = await prisma.promotionalBanner.findFirst();
    if (existingBanner) {
      try {
        if (existingBanner.s3Key) {
          await deleteFromS3(existingBanner.s3Key);
        } else {
          await deleteFromLocal(existingBanner.imageUrl);
        }
      } catch (error) {
        logger.error({ error }, 'Failed to delete old banner');
      }
      await prisma.promotionalBanner.delete({
        where: { id: existingBanner.id },
      });
    }

    // Save new banner to database
    const banner = await prisma.promotionalBanner.create({
      data: {
        imageUrl: publicUrl,
        s3Key,
        uploadedBy: authReq.user.userId,
        width,
        height,
        fileSize,
      },
    });

    await reply.status(201).send({
      id: banner.id,
      imageUrl: banner.imageUrl,
      width: banner.width,
      height: banner.height,
      fileSize: banner.fileSize,
      createdAt: banner.createdAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to validate uploaded banner');
    throw new AppError('VALIDATION_FAILED', 'Failed to validate uploaded banner', 500);
  }
}
