import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';

/**
 * Admin cleanup endpoint to delete old ACTIVE and LOBBY games
 * Only accessible to organizers
 */
export async function cleanupOldGames(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;

    logger.info({ userId: authReq.user.userId }, 'Cleanup games request received');

    // Find all ACTIVE and LOBBY games
    const gamesToDelete = await prisma.game.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { status: 'LOBBY' }
        ]
      },
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

    // Delete all ACTIVE and LOBBY games
    const result = await prisma.game.deleteMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { status: 'LOBBY' }
        ]
      }
    });

    logger.info({ deleted: result.count }, 'Games deleted successfully');

    await reply.send({
      message: `Successfully deleted ${result.count} games`,
      deleted: result.count
    });
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup games');
    await reply.status(500).send({
      error: 'CLEANUP_FAILED',
      message: 'Failed to delete games'
    });
  }
}
