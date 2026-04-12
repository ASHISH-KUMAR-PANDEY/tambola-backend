import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma, GameStatus, GameMode } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import {
  createGameSchema,
  updateGameStatusSchema,
  type CreateGameInput,
  type UpdateGameStatusInput,
} from './games.schema.js';
import { redis } from '../../database/redis.js';
import { getIO } from '../../websocket/io.js';
import { logger } from '../../utils/logger.js';

const VALID_CATEGORIES = ['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE'];
const FIXED_WINNERS_TTL = 86400; // 24 hours

export async function createGame(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const body = createGameSchema.parse(request.body);

    const game = await prisma.game.create({
      data: {
        scheduledTime: new Date(body.scheduledTime),
        createdBy: authReq.user.userId,
        prizes: body.prizes,
        isPublic: body.isPublic ?? false,
      },
    });

    await reply.status(201).send({
      id: game.id,
      scheduledTime: game.scheduledTime,
      status: game.status,
      createdBy: game.createdBy,
      prizes: game.prizes,
      isPublic: game.isPublic,
      createdAt: game.createdAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('CREATE_GAME_FAILED', 'Failed to create game', 500);
  }
}

export async function listGames(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // All games are open to all users - VIP restriction removed
    const query = request.query as { status?: string; userId?: string };
    const baseWhere = query.status ? { status: query.status as any } : {};
    // Exclude WEEKLY games from the LIVE game listing
    const where = { ...baseWhere, gameMode: { not: GameMode.WEEKLY } };
    const games = await prisma.game.findMany({
      where,
      select: {
        id: true,
        scheduledTime: true,
        startedAt: true,
        endedAt: true,
        status: true,
        prizes: true,
        calledNumbers: true,
        currentNumber: true,
        createdBy: true,
        isPublic: true,
      },
      orderBy: { scheduledTime: 'desc' },
      take: 50,
    });

    // Get player counts for each game
    const gamesWithCounts = await Promise.all(
      games.map(async (game) => {
        const playerCount = await prisma.player.count({
          where: { gameId: game.id },
        });
        return {
          id: game.id,
          scheduledTime: game.scheduledTime,
          startedAt: game.startedAt,
          endedAt: game.endedAt,
          status: game.status,
          prizes: game.prizes,
          calledNumbers: game.calledNumbers,
          currentNumber: game.currentNumber,
          createdBy: game.createdBy,
          isPublic: game.isPublic,
          playerCount,
        };
      })
    );

    await reply.send({ games: gamesWithCounts });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('LIST_GAMES_FAILED', 'Failed to fetch games', 500);
  }
}

export async function getGame(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };

    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      throw new AppError('GAME_NOT_FOUND', 'Game not found', 404);
    }

    // Get counts
    const playerCount = await prisma.player.count({
      where: { gameId },
    });
    const winnerCount = await prisma.winner.count({
      where: { gameId },
    });

    // Get winners with player details
    const winners = await prisma.winner.findMany({
      where: { gameId },
    });
    const winnersWithDetails = await Promise.all(
      winners.map(async (winner) => {
        const player = await prisma.player.findUnique({
          where: { id: winner.playerId },
        });
        return {
          playerId: winner.playerId,
          category: winner.category,
          userName: player?.userName || 'Unknown',
          appUserId: player?.userId || null,
        };
      })
    );

    await reply.send({
      id: game.id,
      scheduledTime: game.scheduledTime,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      status: game.status,
      createdBy: game.createdBy,
      prizes: game.prizes,
      calledNumbers: game.calledNumbers,
      currentNumber: game.currentNumber,
      playerCount,
      winnerCount,
      winners: winnersWithDetails,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('GET_GAME_FAILED', 'Failed to fetch game', 500);
  }
}

export async function updateGameStatus(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const { gameId } = request.params as { gameId: string };
    const body = updateGameStatusSchema.parse(request.body);

    // Verify game exists and user is creator
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      throw new AppError('GAME_NOT_FOUND', 'Game not found', 404);
    }

    if (game.createdBy !== authReq.user.userId) {
      throw new AppError('FORBIDDEN', 'Only game creator can update status', 403);
    }

    // Block WEEKLY games — they must be managed via /api/v1/weekly-games endpoints
    if (game.gameMode === GameMode.WEEKLY) {
      throw new AppError('INVALID_GAME_TYPE', 'Weekly games must be managed via the weekly games panel', 400);
    }

    // Update game
    const updateData: any = { status: body.status };

    if (body.status === 'ACTIVE' && !game.startedAt) {
      updateData.startedAt = new Date();
    }

    if (body.status === 'COMPLETED' && !game.endedAt) {
      updateData.endedAt = new Date();
    }

    const updatedGame = await prisma.game.update({
      where: { id: gameId },
      data: updateData,
      select: {
        id: true,
        scheduledTime: true,
        startedAt: true,
        endedAt: true,
        status: true,
        prizes: true,
      },
    });

    // If game is being completed, notify all players in the room
    if (body.status === 'COMPLETED') {
      try {
        const io = getIO();
        io.to(`game:${gameId}`).emit('game:completed', { gameId });
      } catch (error) {
        console.error('Failed to emit game:completed event:', error);
      }
    }

    await reply.send({
      id: updatedGame.id,
      scheduledTime: updatedGame.scheduledTime,
      startedAt: updatedGame.startedAt,
      endedAt: updatedGame.endedAt,
      status: updatedGame.status,
      prizes: updatedGame.prizes,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('UPDATE_GAME_FAILED', 'Failed to update game', 500);
  }
}

export async function getMyActiveGames(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const query = request.query as { userId?: string };
    let userId: string | undefined;

    // Try to get userId from JWT token first (authenticated users)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = request.server.jwt.verify<{ userId: string }>(token);
        userId = decoded.userId;
      } catch (error) {
        // Token invalid or expired, fall back to query param
        console.warn('Invalid JWT token in getMyActiveGames:', error);
      }
    }

    // Fall back to query param (mobile app users without JWT)
    if (!userId) {
      userId = query.userId;
    }

    if (!userId) {
      await reply.send({ games: [] });
      return;
    }

    // Find all games the player has joined that are still active or in lobby
    const playerRecords = await prisma.player.findMany({
      where: { userId },
      select: { id: true, gameId: true, ticket: true },
    });

    if (playerRecords.length === 0) {
      await reply.send({ games: [] });
      return;
    }

    const gameIds = playerRecords.map((p) => p.gameId);

    // Get games that are still LOBBY or ACTIVE
    const games = await prisma.game.findMany({
      where: {
        id: { in: gameIds },
        status: { in: [GameStatus.LOBBY, GameStatus.ACTIVE] },
      },
      select: {
        id: true,
        scheduledTime: true,
        startedAt: true,
        status: true,
        prizes: true,
        calledNumbers: true,
        currentNumber: true,
      },
      orderBy: { scheduledTime: 'desc' },
    });

    // Attach player's ticket and marked numbers to each game
    const gamesWithTickets = await Promise.all(
      games.map(async (game) => {
        const playerRecord = playerRecords.find((p) => p.gameId === game.id);

        // Fetch marked numbers from Redis
        let markedNumbers: number[] = [];
        if (playerRecord) {
          const key = `game:${game.id}:player:${playerRecord.id}:ticket`;
          const markedNumbersStr = await redis.hget(key, 'markedNumbers');
          markedNumbers = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];
        }

        return {
          id: game.id,
          scheduledTime: game.scheduledTime,
          startedAt: game.startedAt,
          status: game.status,
          prizes: game.prizes,
          calledNumbers: game.calledNumbers || [],
          currentNumber: game.currentNumber,
          ticket: playerRecord?.ticket,
          playerId: playerRecord?.id,
          markedNumbers,
        };
      })
    );

    await reply.send({ games: gamesWithTickets });
  } catch (error) {
    throw new AppError('GET_ACTIVE_GAMES_FAILED', 'Failed to get active games', 500);
  }
}

export async function getPlayerDetails(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { gameId, playerId } = request.params as { gameId: string; playerId: string };

    const player = await prisma.player.findUnique({
      where: { id: playerId },
      include: {
        winners: true,
        game: true,
      },
    });

    if (!player) {
      throw new AppError('PLAYER_NOT_FOUND', 'Player not found', 404);
    }

    if (player.gameId !== gameId) {
      throw new AppError('PLAYER_NOT_IN_GAME', 'Player not in specified game', 400);
    }

    // Get prize queue data
    const prizeQueue = await prisma.prizeQueue.findMany({
      where: { userId: player.userId, gameId: player.gameId },
    });

    // Check if user is registered
    const user = await prisma.user.findFirst({
      where: { id: player.userId },
    });

    await reply.send({
      player: {
        id: player.id,
        appUserId: player.userId,
        userName: player.userName,
        ticket: player.ticket,
        joinedAt: player.joinedAt,
        gameId: player.gameId,
      },
      winners: player.winners.map(w => ({
        id: w.id,
        category: w.category,
        claimedAt: w.claimedAt,
        prizeClaimed: w.prizeClaimed,
        prizeValue: w.prizeValue,
      })),
      prizeQueue: prizeQueue.map(pq => ({
        id: pq.id,
        category: pq.category,
        prizeValue: pq.prizeValue,
        status: pq.status,
        attempts: pq.attempts,
        lastAttempt: pq.lastAttempt,
        error: pq.error,
        createdAt: pq.createdAt,
      })),
      user: user ? {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      } : null,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('GET_PLAYER_FAILED', 'Failed to fetch player details', 500);
  }
}

export async function deleteGame(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const { gameId } = request.params as { gameId: string };

    // Verify game exists and user is creator
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      throw new AppError('GAME_NOT_FOUND', 'Game not found', 404);
    }

    if (game.createdBy !== authReq.user.userId) {
      throw new AppError('FORBIDDEN', 'Only game creator can delete game', 403);
    }

    // Can only delete games that haven't started
    if (game.status !== GameStatus.LOBBY) {
      throw new AppError(
        'INVALID_OPERATION',
        'Cannot delete game that has started',
        400
      );
    }

    // Notify all players in the game room before deletion
    try {
      const io = getIO();
      io.to(`game:${gameId}`).emit('game:deleted', {
        gameId,
        message: 'Game has been deleted by the organizer',
      });
    } catch (error) {
      // Log error but continue with deletion
      console.error('Failed to emit game:deleted event:', error);
    }

    // Delete related documents
    await prisma.player.deleteMany({
      where: { gameId },
    });
    await prisma.winner.deleteMany({
      where: { gameId },
    });
    await prisma.game.delete({
      where: { id: gameId },
    });

    await reply.status(204).send();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('DELETE_GAME_FAILED', 'Failed to delete game', 500);
  }
}

// >>> FIXED WINNERS — START

export async function setFixedWinners(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };
    const body = request.body as Record<string, string>;

    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'Body must be a non-empty object of { category: userId }', 400);
    }

    // Validate categories and userIds
    const entries: [string, string][] = [];
    for (const [category, userId] of Object.entries(body)) {
      if (!VALID_CATEGORIES.includes(category)) {
        throw new AppError('VALIDATION_ERROR', `Invalid category: ${category}. Valid: ${VALID_CATEGORIES.join(', ')}`, 400);
      }
      if (!userId || typeof userId !== 'string' || !userId.trim()) {
        throw new AppError('VALIDATION_ERROR', `userId for ${category} must be a non-empty string`, 400);
      }
      entries.push([category, userId.trim()]);
    }

    // Verify game exists
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      throw new AppError('GAME_NOT_FOUND', 'Game not found', 404);
    }

    // Write to Redis hash
    const key = `game:${gameId}:fixedWinners`;
    const pipeline = redis.pipeline();
    pipeline.del(key);
    for (const [category, userId] of entries) {
      pipeline.hset(key, category, userId);
    }
    pipeline.expire(key, FIXED_WINNERS_TTL);
    await pipeline.exec();

    logger.info({ gameId, fixedWinners: Object.fromEntries(entries) }, 'Fixed winners set');

    reply.send({
      success: true,
      fixedCategories: entries.map(([cat]) => cat),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('SET_FIXED_WINNERS_FAILED', 'Failed to set fixed winners', 500);
  }
}

export async function getFixedWinners(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };
    const key = `game:${gameId}:fixedWinners`;
    const data = await redis.hgetall(key);
    reply.send(data || {});
  } catch (error) {
    throw new AppError('GET_FIXED_WINNERS_FAILED', 'Failed to get fixed winners', 500);
  }
}

export async function deleteFixedWinners(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };
    await redis.del(`game:${gameId}:fixedWinners`);
    logger.info({ gameId }, 'Fixed winners deleted (kill switch)');
    reply.send({ success: true, message: 'Fixed winners removed' });
  } catch (error) {
    throw new AppError('DELETE_FIXED_WINNERS_FAILED', 'Failed to delete fixed winners', 500);
  }
}

export async function deleteFixedWinnerCategory(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { gameId, category } = request.params as { gameId: string; category: string };
    if (!VALID_CATEGORIES.includes(category)) {
      throw new AppError('VALIDATION_ERROR', `Invalid category: ${category}`, 400);
    }
    await redis.hdel(`game:${gameId}:fixedWinners`, category);
    logger.info({ gameId, category }, 'Fixed winner for category deleted');
    reply.send({ success: true, message: `Fixed winner for ${category} removed` });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DELETE_FIXED_WINNER_FAILED', 'Failed to delete fixed winner', 500);
  }
}

// >>> FIXED WINNERS — END
