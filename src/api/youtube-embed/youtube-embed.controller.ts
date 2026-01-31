import type { FastifyReply, FastifyRequest } from 'fastify';
import { YouTubeEmbed } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { logger } from '../../utils/logger.js';

/**
 * Extract YouTube video ID from various URL formats
 */
function extractYouTubeId(url: string): string | null {
  // Handle various YouTube URL formats:
  // - https://www.youtube.com/watch?v=VIDEO_ID
  // - https://youtu.be/VIDEO_ID
  // - https://www.youtube.com/embed/VIDEO_ID
  // - https://www.youtube.com/v/VIDEO_ID

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
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

export async function setYouTubeEmbed(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const { videoUrl } = request.body as { videoUrl: string };

    if (!videoUrl) {
      throw new AppError('NO_VIDEO_URL', 'Video URL is required', 400);
    }

    // Extract YouTube video ID
    const embedId = extractYouTubeId(videoUrl);

    if (!embedId) {
      throw new AppError(
        'INVALID_YOUTUBE_URL',
        'Invalid YouTube URL. Please provide a valid YouTube video URL.',
        400
      );
    }

    // Delete old embed if exists (only one active embed at a time)
    const existingEmbed = await YouTubeEmbed.findOne();
    if (existingEmbed) {
      await YouTubeEmbed.deleteOne({ _id: existingEmbed._id });
    }

    // Save new embed to database
    const embed = await YouTubeEmbed.create({
      videoUrl,
      embedId,
      uploadedBy: authReq.user.userId,
    });

    logger.info({ embedId, videoUrl }, 'YouTube embed set');

    await reply.status(201).send({
      id: embed._id.toString(),
      videoUrl: embed.videoUrl,
      embedId: embed.embedId,
      createdAt: embed.createdAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to set YouTube embed');
    throw new AppError('SET_EMBED_FAILED', 'Failed to set YouTube embed', 500);
  }
}

export async function getCurrentYouTubeEmbed(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const embed = await YouTubeEmbed.findOne().sort({ createdAt: -1 }).lean();

    if (!embed) {
      await reply.send({ embed: null });
      return;
    }

    await reply.send({
      embed: {
        id: embed._id.toString(),
        videoUrl: embed.videoUrl,
        embedId: embed.embedId,
        createdAt: embed.createdAt,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get YouTube embed');
    throw new AppError('GET_EMBED_FAILED', 'Failed to get YouTube embed', 500);
  }
}

export async function deleteYouTubeEmbed(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const embed = await YouTubeEmbed.findOne();

    if (!embed) {
      throw new AppError('EMBED_NOT_FOUND', 'No YouTube embed found', 404);
    }

    // Delete from database
    await YouTubeEmbed.deleteOne({ _id: embed._id });

    logger.info({ embedId: embed.embedId }, 'YouTube embed deleted');

    await reply.status(204).send();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to delete YouTube embed');
    throw new AppError('DELETE_EMBED_FAILED', 'Failed to delete YouTube embed', 500);
  }
}
