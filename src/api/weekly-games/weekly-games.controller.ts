import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma, GameMode, GameStatus, WinCategory } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { createWeeklyGameSchema, markNumberSchema, claimWinSchema } from './weekly-games.schema.js';
import {
  createWeeklyGame,
  joinWeeklyGame,
  getWeeklyPlayerState,
  markWeeklyNumber,
  claimWeeklyWin,
  calculateResults,
} from '../../services/weekly-game.service.js';

/**
 * POST /api/v1/weekly-games — Create a weekly game (organizer only)
 */
export async function create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const body = createWeeklyGameSchema.parse(request.body);

    const game = await createWeeklyGame({
      createdBy: authReq.user.userId,
      prizes: body.prizes,
      revealIntervalMin: body.revealIntervalMin,
      resultDate: body.resultDate,
    });

    await reply.status(201).send({
      id: game.id,
      gameMode: game.gameMode,
      status: game.status,
      prizes: game.prizes,
      revealIntervalMin: game.revealIntervalMin,
      resultDate: game.resultDate,
      createdAt: game.createdAt,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('CREATE_WEEKLY_GAME_FAILED', error instanceof Error ? error.message : 'Failed to create weekly game', 500);
  }
}

/**
 * GET /api/v1/weekly-games — List active weekly games
 */
export async function list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const games = await prisma.game.findMany({
      where: {
        gameMode: GameMode.WEEKLY,
        status: { in: [GameStatus.ACTIVE, GameStatus.COMPLETED] },
      },
      select: {
        id: true,
        status: true,
        prizes: true,
        revealedCount: true,
        revealIntervalMin: true,
        resultDate: true,
        startedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Attach player counts
    const gamesWithCounts = await Promise.all(
      games.map(async (game) => {
        const playerCount = await prisma.player.count({ where: { gameId: game.id } });
        return { ...game, playerCount };
      })
    );

    await reply.send({ games: gamesWithCounts });
  } catch (error) {
    throw new AppError('LIST_WEEKLY_GAMES_FAILED', 'Failed to list weekly games', 500);
  }
}

/**
 * GET /api/v1/weekly-games/:gameId — Get weekly game details
 */
export async function get(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        status: true,
        gameMode: true,
        prizes: true,
        revealedCount: true,
        revealIntervalMin: true,
        lastRevealedAt: true,
        resultDate: true,
        startedAt: true,
        numberSequence: true,
      },
    });

    if (!game) throw new AppError('GAME_NOT_FOUND', 'Game not found', 404);
    if (game.gameMode !== GameMode.WEEKLY) throw new AppError('NOT_WEEKLY', 'Not a weekly game', 400);

    const playerCount = await prisma.player.count({ where: { gameId } });
    const revealedNumbers = game.numberSequence.slice(0, game.revealedCount);

    await reply.send({
      id: game.id,
      status: game.status,
      prizes: game.prizes,
      revealedNumbers,
      revealedCount: game.revealedCount,
      currentNumber: revealedNumbers.length > 0 ? revealedNumbers[revealedNumbers.length - 1] : null,
      revealIntervalMin: game.revealIntervalMin,
      lastRevealedAt: game.lastRevealedAt,
      resultDate: game.resultDate,
      startedAt: game.startedAt,
      playerCount,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('GET_WEEKLY_GAME_FAILED', 'Failed to get weekly game', 500);
  }
}

/**
 * POST /api/v1/weekly-games/:gameId/join — Join a weekly game
 */
export async function join(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };
    const query = request.query as { userId?: string; userName?: string };

    // Try JWT auth first, fallback to query params (mobile app users)
    let userId: string | undefined;
    let userName = query.userName || 'Player';

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = request.server.jwt.verify<{ userId: string; email: string }>(token);
        userId = decoded.userId;
      } catch {
        // Fall through to query param
      }
    }

    if (!userId) userId = query.userId;
    if (!userId) throw new AppError('UNAUTHORIZED', 'userId required', 401);

    const player = await joinWeeklyGame(gameId, userId, userName);

    await reply.status(201).send({
      playerId: player.id,
      ticket: player.ticket,
      gameId,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('JOIN_WEEKLY_GAME_FAILED', error instanceof Error ? error.message : 'Failed to join', 400);
  }
}

/**
 * GET /api/v1/weekly-games/:gameId/my-state — Get player's state
 */
export async function myState(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };
    const query = request.query as { userId?: string };

    let userId: string | undefined;

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = request.server.jwt.verify<{ userId: string }>(token);
        userId = decoded.userId;
      } catch {
        // Fall through
      }
    }

    if (!userId) userId = query.userId;
    if (!userId) throw new AppError('UNAUTHORIZED', 'userId required', 401);

    const state = await getWeeklyPlayerState(gameId, userId);
    await reply.send(state);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('GET_STATE_FAILED', error instanceof Error ? error.message : 'Failed to get state', 400);
  }
}

/**
 * POST /api/v1/weekly-games/:gameId/mark — Mark a number
 */
export async function mark(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };
    const body = markNumberSchema.parse(request.body);
    const query = request.query as { userId?: string };

    let userId: string | undefined;

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = request.server.jwt.verify<{ userId: string }>(token);
        userId = decoded.userId;
      } catch {
        // Fall through
      }
    }

    if (!userId) userId = query.userId;
    if (!userId) throw new AppError('UNAUTHORIZED', 'userId required', 401);

    const result = await markWeeklyNumber(gameId, userId, body.number);
    await reply.send(result);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('MARK_NUMBER_FAILED', error instanceof Error ? error.message : 'Failed to mark number', 400);
  }
}

/**
 * POST /api/v1/weekly-games/:gameId/claim — Claim a win
 */
export async function claim(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };
    const body = claimWinSchema.parse(request.body);
    const query = request.query as { userId?: string };

    let userId: string | undefined;

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = request.server.jwt.verify<{ userId: string }>(token);
        userId = decoded.userId;
      } catch {
        // Fall through
      }
    }

    if (!userId) userId = query.userId;
    if (!userId) throw new AppError('UNAUTHORIZED', 'userId required', 401);

    const result = await claimWeeklyWin(gameId, userId, body.category as WinCategory);
    await reply.send(result);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('CLAIM_WIN_FAILED', error instanceof Error ? error.message : 'Failed to claim win', 400);
  }
}

/**
 * GET /api/v1/weekly-games/:gameId/results — Get results
 */
export async function results(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const { gameId } = request.params as { gameId: string };

    const result = await calculateResults(gameId);
    await reply.send(result);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('GET_RESULTS_FAILED', error instanceof Error ? error.message : 'Failed to get results', 500);
  }
}
