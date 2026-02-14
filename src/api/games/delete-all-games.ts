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

    // Delete all games in transaction with related records
    const result = await prisma.$transaction(async (tx) => {
      // Get all game IDs
      const games = await tx.game.findMany({ select: { id: true } });
      const gameIds = games.map(g => g.id);

      // Delete related records first
      await tx.winner.deleteMany({});
      await tx.player.deleteMany({});
      await tx.gameLobbyPlayer.deleteMany({});
      await tx.prizeQueue.deleteMany({});

      // Delete all games
      const deleted = await tx.game.deleteMany({});

      return deleted.count;
    });

    logger.info({ deleted: result }, 'All games deleted successfully');

    await reply.send({
      message: `Successfully deleted ALL ${result} games`,
      deleted: result
    });
  } catch (error) {
    logger.error({ error }, 'Failed to delete all games');
    await reply.status(500).send({
      error: 'DELETE_ALL_FAILED',
      message: 'Failed to delete all games'
    });
  }
}
