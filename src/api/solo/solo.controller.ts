import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { prisma } from '../../models/index.js';
import {
  startSoloGame,
  validateAndRecordClaim,
  getUserCurrentWeekGame,
  updateGameProgress,
  completeGame,
} from '../../services/solo-game.service.js';
import {
  getOrCreateCurrentWeek,
  isSoloGameDay,
  isSunday,
  isWeekConfigured,
  configureSoloWeekVideo,
  extractYouTubeVideoId,
  finalizeWeek as finalizeWeekService,
} from '../../services/solo-week.service.js';
import { claimSchema, updateProgressSchema, completeGameSchema, configureWeekSchema } from './solo.schema.js';
import { AppError } from '../../utils/error.js';

function getUserId(request: FastifyRequest): string {
  const { userId } = request.query as { userId?: string };
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'userId query parameter is required', 400);
  }
  return userId;
}

/**
 * GET /api/v1/solo/current-week
 * Returns current week info + stats. If authenticated, includes user's play status.
 */
export async function getCurrentWeek(request: FastifyRequest, reply: FastifyReply) {
  const week = await getOrCreateCurrentWeek();
  const user = (request as AuthenticatedRequest).user;

  // Count players this week
  const playerCount = await prisma.soloGame.count({
    where: { weekId: week.id },
  });

  // Check if user has played
  let hasPlayed = false;
  let gameStatus = null;
  if (user?.userId) {
    const game = await prisma.soloGame.findUnique({
      where: { userId_weekId: { userId: user.userId, weekId: week.id } },
      select: { status: true },
    });
    if (game) {
      hasPlayed = true;
      gameStatus = game.status;
    }
  }

  return reply.send({
    week: {
      id: week.id,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      status: week.status,
      finalizedAt: week.finalizedAt,
      videoUrl: week.videoUrl,
      videoId: week.videoId,
      isConfigured: isWeekConfigured(week),
    },
    stats: {
      playerCount,
    },
    userStatus: {
      hasPlayed,
      gameStatus,
    },
    flags: {
      isSoloGameDay: isSoloGameDay(),
      isSunday: isSunday(),
    },
  });
}

/**
 * POST /api/v1/solo/start-game?userId=xxx
 */
export async function startGame(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request);
  const game = await startSoloGame(userId);
  const week = (game as any).week;

  return reply.status(201).send({
    soloGameId: game.id,
    weekId: game.weekId,
    ticket: game.ticket,
    numberSequence: game.numberSequence,
    status: game.status,
    videoUrl: week?.videoUrl || null,
    videoId: week?.videoId || null,
    numberTimestamps: week?.numberTimestamps || [],
  });
}

/**
 * POST /api/v1/solo/claim?userId=xxx
 */
export async function claimCategory(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request);
  const parsed = claimSchema.safeParse(request.body);

  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message, 400);
  }

  const { soloGameId, category, currentNumberIndex } = parsed.data;
  const { claim, gameComplete } = await validateAndRecordClaim(
    soloGameId,
    userId,
    category as any,
    currentNumberIndex
  );

  return reply.send({
    claim: {
      id: claim.id,
      category: claim.category,
      numberCountAtClaim: claim.numberCountAtClaim,
      claimedAt: claim.claimedAt,
    },
    gameComplete,
  });
}

/**
 * GET /api/v1/solo/my-game?userId=xxx
 */
export async function getMyGame(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request);
  const { game, week } = await getUserCurrentWeekGame(userId);

  if (!game) {
    return reply.send({
      game: null,
      canPlay: isSoloGameDay(),
      isSunday: isSunday(),
      isConfigured: isWeekConfigured(week),
      currentWeek: {
        id: week.id,
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        status: week.status,
      },
    });
  }

  return reply.send({
    game: {
      id: game.id,
      weekId: game.weekId,
      ticket: game.ticket,
      numberSequence: game.numberSequence,
      markedNumbers: game.markedNumbers,
      currentIndex: game.currentIndex,
      status: game.status,
      startedAt: game.startedAt,
      completedAt: game.completedAt,
      claims: game.claims.map(c => ({
        id: c.id,
        category: c.category,
        numberCountAtClaim: c.numberCountAtClaim,
        claimedAt: c.claimedAt,
      })),
    },
    videoUrl: week.videoUrl || null,
    videoId: week.videoId || null,
    numberTimestamps: week.numberTimestamps || [],
    canPlay: false,
    isSunday: isSunday(),
    currentWeek: {
      id: week.id,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      status: week.status,
    },
  });
}

/**
 * PATCH /api/v1/solo/update-progress?userId=xxx
 */
export async function updateProgress(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request);
  const parsed = updateProgressSchema.safeParse(request.body);

  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message, 400);
  }

  const { soloGameId, currentIndex, markedNumbers } = parsed.data;
  await updateGameProgress(soloGameId, userId, currentIndex, markedNumbers);

  return reply.send({ success: true });
}

/**
 * POST /api/v1/solo/complete-game?userId=xxx
 */
export async function completeGameEndpoint(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request);
  const parsed = completeGameSchema.safeParse(request.body);

  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message, 400);
  }

  const { soloGameId, markedNumbers } = parsed.data;
  await completeGame(soloGameId, userId, markedNumbers);

  return reply.send({ success: true });
}

/**
 * GET /api/v1/solo/leaderboard
 * Weekly leaderboard — live (ACTIVE) or finalized.
 */
export async function getLeaderboard(request: FastifyRequest, reply: FastifyReply) {
  const { weekId } = (request.query as any) || {};

  let week;
  if (weekId) {
    week = await prisma.soloWeek.findUnique({ where: { id: weekId } });
    if (!week) throw new AppError('WEEK_NOT_FOUND', 'Week not found', 404);
  } else {
    week = await getOrCreateCurrentWeek();
  }

  if (week.status === 'FINALIZED') {
    // Return finalized winners
    const winners = await prisma.soloWeeklyWinner.findMany({
      where: { weekId: week.id },
      orderBy: { category: 'asc' },
    });

    return reply.send({
      week: {
        id: week.id,
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        status: week.status,
        finalizedAt: week.finalizedAt,
      },
      leaderboard: winners.map(w => ({
        category: w.category,
        userId: w.userId,
        userName: w.userName,
        numberCountAtClaim: w.numberCountAtClaim,
        claimedAt: w.claimedAt,
        isFinalized: true,
      })),
    });
  }

  // Live leaderboard — best claims per category so far
  const categories = ['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE'] as const;
  const leaderboard = [];

  for (const category of categories) {
    const bestClaim = await prisma.soloClaim.findFirst({
      where: {
        category,
        soloGame: { weekId: week.id },
      },
      orderBy: [
        { numberCountAtClaim: 'asc' },
        { claimedAt: 'asc' },
      ],
      include: {
        soloGame: { select: { userId: true } },
      },
    });

    if (bestClaim) {
      const user = await prisma.user.findUnique({
        where: { id: bestClaim.soloGame.userId },
        select: { name: true },
      });

      leaderboard.push({
        category,
        userId: bestClaim.soloGame.userId,
        userName: user?.name || null,
        numberCountAtClaim: bestClaim.numberCountAtClaim,
        claimedAt: bestClaim.claimedAt,
        isFinalized: false,
      });
    }
  }

  // Count total players
  const playerCount = await prisma.soloGame.count({ where: { weekId: week.id } });

  return reply.send({
    week: {
      id: week.id,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      status: week.status,
    },
    leaderboard,
    playerCount,
  });
}

/**
 * POST /api/v1/solo/finalize-week
 * Admin: finalize weekly winners.
 */
export async function finalizeWeekEndpoint(request: FastifyRequest, reply: FastifyReply) {
  const { role } = (request as AuthenticatedRequest).user;

  if (role !== 'ORGANIZER') {
    throw new AppError('FORBIDDEN', 'Only organizers can finalize weeks', 403);
  }

  const week = await getOrCreateCurrentWeek();
  await finalizeWeekService(week.id);

  return reply.send({ success: true, weekId: week.id });
}

/**
 * POST /api/v1/solo/configure-week
 * Organizer: configure video URL + number sequence + timing for current week.
 */
export async function configureWeek(request: FastifyRequest, reply: FastifyReply) {
  const { userId, role } = (request as AuthenticatedRequest).user;

  if (role !== 'ORGANIZER') {
    throw new AppError('FORBIDDEN', 'Only organizers can configure solo weeks', 403);
  }

  const parsed = configureWeekSchema.safeParse(request.body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', parsed.error.message, 400);
  }

  const { videoUrl, numberSequence, numberTimestamps } = parsed.data;

  // Extract YouTube video ID
  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    throw new AppError('INVALID_VIDEO_URL', 'Could not extract YouTube video ID from URL', 400);
  }

  const week = await getOrCreateCurrentWeek();

  const updated = await configureSoloWeekVideo(week.id, {
    videoUrl,
    videoId,
    numberSequence,
    numberTimestamps,
    configuredBy: userId,
  });

  return reply.send({
    success: true,
    week: {
      id: updated.id,
      videoUrl: updated.videoUrl,
      videoId: updated.videoId,
      numberSequence: updated.numberSequence,
      numberTimestamps: updated.numberTimestamps,
      configuredAt: updated.configuredAt,
    },
  });
}

/**
 * GET /api/v1/solo/week-config
 * Organizer: get current week's video configuration.
 */
export async function getWeekConfig(request: FastifyRequest, reply: FastifyReply) {
  const { role } = (request as AuthenticatedRequest).user;

  if (role !== 'ORGANIZER') {
    throw new AppError('FORBIDDEN', 'Only organizers can view week config', 403);
  }

  const week = await getOrCreateCurrentWeek();

  const gameCount = await prisma.soloGame.count({ where: { weekId: week.id } });

  return reply.send({
    week: {
      id: week.id,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      status: week.status,
      videoUrl: week.videoUrl,
      videoId: week.videoId,
      numberSequence: week.numberSequence,
      numberTimestamps: week.numberTimestamps,
      videoStartTime: week.videoStartTime,
      numberInterval: week.numberInterval,
      configuredAt: week.configuredAt,
      configuredBy: week.configuredBy,
    },
    gameCount,
    isConfigured: isWeekConfigured(week),
    canReconfigure: gameCount === 0,
  });
}
