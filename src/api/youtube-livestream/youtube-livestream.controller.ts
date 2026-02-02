import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { logger } from '../../utils/logger.js';

/**
 * Extract YouTube video ID from various URL formats
 * Works for both regular videos and live streams
 */
function extractYouTubeId(url: string): string | null {
  // Handle various YouTube URL formats:
  // - https://www.youtube.com/watch?v=VIDEO_ID
  // - https://youtu.be/VIDEO_ID
  // - https://www.youtube.com/embed/VIDEO_ID
  // - https://www.youtube.com/v/VIDEO_ID
  // - https://www.youtube.com/live/VIDEO_ID (live streams)

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/live\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/, // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

export async function setYouTubeLiveStream(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const { videoUrl } = request.body as { videoUrl: string };

    if (!videoUrl) {
      throw new AppError('NO_VIDEO_URL', 'Video URL is required', 400);
    }

    // Extract YouTube video/live stream ID
    const embedId = extractYouTubeId(videoUrl);

    if (!embedId) {
      throw new AppError(
        'INVALID_YOUTUBE_URL',
        'Invalid YouTube URL. Please provide a valid YouTube video or live stream URL.',
        400
      );
    }

    // Delete old live stream if exists (only one active live stream at a time)
    const existingStream = await prisma.youTubeLiveStream.findFirst();
    if (existingStream) {
      await prisma.youTubeLiveStream.delete({
        where: { id: existingStream.id },
      });
    }

    // Save new live stream to database
    const stream = await prisma.youTubeLiveStream.create({
      data: {
        videoUrl,
        embedId,
        uploadedBy: authReq.user.userId,
      },
    });

    logger.info({ embedId, videoUrl }, 'YouTube live stream set');

    await reply.status(201).send({
      id: stream.id,
      videoUrl: stream.videoUrl,
      embedId: stream.embedId,
      createdAt: stream.createdAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to set YouTube live stream');
    throw new AppError('SET_LIVESTREAM_FAILED', 'Failed to set YouTube live stream', 500);
  }
}

export async function getCurrentYouTubeLiveStream(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const stream = await prisma.youTubeLiveStream.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!stream) {
      await reply.send({ stream: null });
      return;
    }

    await reply.send({
      stream: {
        id: stream.id,
        videoUrl: stream.videoUrl,
        embedId: stream.embedId,
        createdAt: stream.createdAt,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get YouTube live stream');
    throw new AppError('GET_LIVESTREAM_FAILED', 'Failed to get YouTube live stream', 500);
  }
}

export async function deleteYouTubeLiveStream(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const stream = await prisma.youTubeLiveStream.findFirst();

    if (!stream) {
      throw new AppError('LIVESTREAM_NOT_FOUND', 'No YouTube live stream found', 404);
    }

    // Delete from database
    await prisma.youTubeLiveStream.delete({
      where: { id: stream.id },
    });

    logger.info({ embedId: stream.embedId }, 'YouTube live stream deleted');

    await reply.status(204).send();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to delete YouTube live stream');
    throw new AppError('DELETE_LIVESTREAM_FAILED', 'Failed to delete YouTube live stream', 500);
  }
}
