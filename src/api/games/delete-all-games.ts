import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';

/**
 * ADMIN ENDPOINT: Delete ALL games regardless of status
 * WARNING: This is a destructive operation!
 */
export async function deleteAllGames(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;

    logger.info({ userId: authReq.user.userId }, 'Delete ALL games request received');

    // Get count before deletion
    const totalCount = await prisma.game.count();

    logger.info({ count: totalCount }, 'Total games to delete');

    if (totalCount === 0) {
      await reply.send({
        message: 'No games to delete',
        deleted: 0
      });
      return;
    }

    // Delete all games (CASCADE will handle related records)
    const result = await prisma.game.deleteMany({});

    logger.info({ deleted: result.count }, 'All games deleted successfully');

    await reply.send({
      message: `Successfully deleted ALL ${result.count} games`,
      deleted: result.count
    });
  } catch (error) {
    logger.error({ error }, 'Failed to delete all games');
    await reply.status(500).send({
      error: 'DELETE_ALL_FAILED',
      message: 'Failed to delete all games'
    });
  }
}
