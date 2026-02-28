import type { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../../database/redis.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { logger } from '../../utils/logger.js';
import { parse } from 'csv-parse/sync';

const VIP_USERS_KEY = 'vip:users';

/**
 * Upload/Replace VIP user list from CSV
 * CSV Format: userId (one per line)
 */
export async function uploadVIPList(
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

    // Check if file is CSV
    if (!data.filename.endsWith('.csv')) {
      throw new AppError('INVALID_FILE', 'File must be a CSV', 400);
    }

    const buffer = await data.toBuffer();
    const csvContent = buffer.toString('utf-8');

    // Parse CSV
    let records: any[];
    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to parse CSV');
      throw new AppError('INVALID_CSV', 'Invalid CSV format', 400);
    }

    // Extract userIds
    const userIds: string[] = [];
    for (const record of records) {
      const userId = record.userId || record.userid || record.UserId || record.USERID;
      if (userId && typeof userId === 'string' && userId.trim()) {
        userIds.push(userId.trim());
      }
    }

    if (userIds.length === 0) {
      throw new AppError('EMPTY_CSV', 'CSV contains no valid userIds', 400);
    }

    // Remove duplicates
    const uniqueUserIds = [...new Set(userIds)];

    logger.info({
      uploadedBy: authReq.user.userId,
      totalRows: records.length,
      validUserIds: uniqueUserIds.length,
      duplicatesRemoved: userIds.length - uniqueUserIds.length,
    }, 'VIP list upload started');

    // Replace the entire VIP list in Redis
    // Use pipeline for atomic operation
    const pipeline = redis.pipeline();

    // Delete existing set
    pipeline.del(VIP_USERS_KEY);

    // Add all userIds to the set (batch add for performance)
    if (uniqueUserIds.length > 0) {
      pipeline.sadd(VIP_USERS_KEY, ...uniqueUserIds);
    }

    await pipeline.exec();

    logger.info({
      uploadedBy: authReq.user.userId,
      count: uniqueUserIds.length,
    }, 'VIP list replaced successfully');

    reply.send({
      success: true,
      count: uniqueUserIds.length,
      message: `VIP list updated with ${uniqueUserIds.length} members`,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error({ error }, 'Failed to upload VIP list');
    throw new AppError('UPLOAD_FAILED', 'Failed to upload VIP list', 500);
  }
}

/**
 * Download current VIP user list as CSV
 */
export async function downloadVIPList(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Get all VIP userIds from Redis
    const userIds = await redis.smembers(VIP_USERS_KEY);

    if (userIds.length === 0) {
      throw new AppError('NO_VIP_USERS', 'No VIP users found', 404);
    }

    // Sort for consistent output
    userIds.sort();

    // Generate CSV content
    const csvContent = 'userId\n' + userIds.join('\n');

    // Set headers for file download
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="vip-users-${Date.now()}.csv"`)
      .send(csvContent);

    logger.info({ count: userIds.length }, 'VIP list downloaded');
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    logger.error({ error }, 'Failed to download VIP list');
    throw new AppError('DOWNLOAD_FAILED', 'Failed to download VIP list', 500);
  }
}

/**
 * Get VIP user statistics
 */
export async function getVIPStats(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Get count of VIP users
    const count = await redis.scard(VIP_USERS_KEY);

    // Get sample users (first 10)
    const sampleUsers = await redis.srandmember(VIP_USERS_KEY, 10);

    reply.send({
      success: true,
      count,
      sampleUsers: sampleUsers || [],
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get VIP stats');
    throw new AppError('STATS_FAILED', 'Failed to get VIP statistics', 500);
  }
}

/**
 * Check if a user is VIP
 * Helper function for other controllers/handlers
 */
export async function isUserVIP(userId: string): Promise<boolean> {
  try {
    const isMember = await redis.sismember(VIP_USERS_KEY, userId);
    return isMember === 1;
  } catch (error) {
    logger.error({ error, userId }, 'Failed to check VIP status');
    // Fail open - allow access on Redis errors to prevent outages
    return true;
  }
}

/**
 * Check if current authenticated user is VIP
 * API endpoint for frontend to check VIP status
 */
export async function checkVIPStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const userId = authReq.user.userId;

    const isVIP = await isUserVIP(userId);

    logger.info({ userId, isVIP }, 'VIP status checked');

    reply.send({ isVIP });
  } catch (error) {
    logger.error({ error }, 'Failed to check VIP status');
    // Fail open - return true on errors
    reply.send({ isVIP: true });
  }
}
