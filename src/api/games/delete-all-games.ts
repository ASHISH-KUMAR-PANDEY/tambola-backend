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

    // Delete all games one by one (CASCADE will handle related records)
    const games = await prisma.game.findMany({ select: { id: true } });
    let deletedCount = 0;

    for (const game of games) {
      await prisma.game.delete({ where: { id: game.id } });
      deletedCount++;
    }

    logger.info({ deleted: deletedCount }, 'All games deleted successfully');

    await reply.send({
      message: `Successfully deleted ALL ${deletedCount} games`,
      deleted: deletedCount
    });
  } catch (error) {
    logger.error({ error }, 'Failed to delete all games');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';

    logger.error({ errorMessage, errorStack }, 'Detailed error info');

    await reply.status(500).send({
      error: 'DELETE_ALL_FAILED',
      message: `Failed to delete all games: ${errorMessage}`
    });
  }
}
