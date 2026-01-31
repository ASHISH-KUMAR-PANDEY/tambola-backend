import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { PromotionalBanner } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { uploadToS3, deleteFromS3, extractS3Key } from '../../services/s3.service.js';

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

    // Upload to S3
    const imageUrl = await uploadToS3(
      buffer,
      data.filename,
      data.mimetype
    );

    const s3Key = extractS3Key(imageUrl);

    // Delete old banner if exists
    const existingBanner = await PromotionalBanner.findOne();
    if (existingBanner) {
      try {
        await deleteFromS3(existingBanner.s3Key);
      } catch (error) {
        console.error('Failed to delete old banner from S3:', error);
      }
      await PromotionalBanner.deleteOne({ _id: existingBanner._id });
    }

    // Save new banner to database
    const banner = await PromotionalBanner.create({
      imageUrl,
      s3Key,
      uploadedBy: authReq.user.userId,
      width,
      height,
      fileSize: buffer.length,
    });

    await reply.status(201).send({
      id: banner._id.toString(),
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
    const banner = await PromotionalBanner.findOne().sort({ createdAt: -1 }).lean();

    if (!banner) {
      await reply.send({ banner: null });
      return;
    }

    await reply.send({
      banner: {
        id: banner._id.toString(),
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
    const banner = await PromotionalBanner.findOne();

    if (!banner) {
      throw new AppError('BANNER_NOT_FOUND', 'No promotional banner found', 404);
    }

    // Delete from S3
    try {
      await deleteFromS3(banner.s3Key);
    } catch (error) {
      console.error('Failed to delete banner from S3:', error);
    }

    // Delete from database
    await PromotionalBanner.deleteOne({ _id: banner._id });

    await reply.status(204).send();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('DELETE_BANNER_FAILED', 'Failed to delete promotional banner', 500);
  }
}
