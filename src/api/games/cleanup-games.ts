import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';

/**
 * Admin cleanup endpoint to delete ALL games (ACTIVE, LOBBY, and COMPLETED)
 * Only accessible to organizers
 */
export async function cleanupOldGames(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;

    logger.info({ userId: authReq.user.userId }, 'Cleanup games request received');

    // Find all games (ACTIVE, LOBBY, and COMPLETED)
    const gamesToDelete = await prisma.game.findMany({
      select: {
        id: true,
        status: true,
        scheduledTime: true,
        createdBy: true
      }
    });

    logger.info({ count: gamesToDelete.length }, 'Found games to delete');

    if (gamesToDelete.length === 0) {
      await reply.send({
        message: 'No games to delete',
        deleted: 0
      });
      return;
    }

    // Delete all games one by one (CASCADE will handle related records)
    let deletedCount = 0;
    for (const game of gamesToDelete) {
      await prisma.game.delete({ where: { id: game.id } });
      deletedCount++;
    }

    logger.info({ deleted: deletedCount }, 'Games deleted successfully');

    await reply.send({
      message: `Successfully deleted ${deletedCount} games`,
      deleted: deletedCount
    });
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup games');
    await reply.status(500).send({
      error: 'CLEANUP_FAILED',
      message: 'Failed to delete games'
    });
  }
}
