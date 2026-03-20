import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { prisma } from '../../models/index.js';
import {
  startSoloGame,
  validateAndRecordClaim,
  getUserCurrentWeekGames,
  updateGameProgress,
  completeGame,
} from '../../services/solo-game.service.js';
import {
  getOrCreateCurrentWeek,
  isSoloGameDay,
  isSunday,
  isWeekConfigured,
  isGame2Configured,
  configureSoloWeekVideo,
  configureSoloWeekGame2Video,
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
  const { userId: queryUserId } = request.query as { userId?: string };
  const resolvedUserId = user?.userId || queryUserId;

  // Count players this week
  const playerCount = await prisma.soloGame.count({
    where: { weekId: week.id },
  });

  // Check if user has played
  let hasPlayed = false;
  let gameStatus = null;
  let game2Status: {
    available: boolean;
    cooldownEndsAt: string | null;
    hasPlayed: boolean;
    gameStatus: string | null;
  } = {
    available: false,
    cooldownEndsAt: null,
    hasPlayed: false,
    gameStatus: null,
  };

  if (resolvedUserId) {
    const game1 = await prisma.soloGame.findUnique({
      where: { userId_weekId_gameNumber: { userId: resolvedUserId, weekId: week.id, gameNumber: 1 } },
      select: { status: true, completedAt: true },
    });
    if (game1) {
      hasPlayed = true;
      gameStatus = game1.status;

      // Compute Game 2 status
      if (game1.status === 'COMPLETED' && isGame2Configured(week)) {
        const game2 = await prisma.soloGame.findUnique({
          where: { userId_weekId_gameNumber: { userId: resolvedUserId, weekId: week.id, gameNumber: 2 } },
          select: { status: true },
        });

        if (game2) {
          game2Status.hasPlayed = true;
          game2Status.gameStatus = game2.status;
        }

        // Compute cooldown
        if (game1.completedAt) {
          const cooldownEnd = new Date(game1.completedAt.getTime() + 24 * 60 * 60 * 1000);
          if (new Date() >= cooldownEnd) {
            game2Status.available = !game2; // Available if not already started
          } else {
            game2Status.cooldownEndsAt = cooldownEnd.toISOString();
          }
        }
      }
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
      isGame2Configured: isGame2Configured(week),
    },
    stats: {
      playerCount,
    },
    userStatus: {
      hasPlayed,
      gameStatus,
      game2Status,
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
  const { gameNumber: gameNumberStr } = request.query as { gameNumber?: string };
  const gameNumber = gameNumberStr ? parseInt(gameNumberStr, 10) : 1;

  const game = await startSoloGame(userId, gameNumber);
  const week = (game as any).week;

  // Return correct video fields based on game number
  const videoUrl = gameNumber === 2 ? week?.game2VideoUrl : week?.videoUrl;
  const videoId = gameNumber === 2 ? week?.game2VideoId : week?.videoId;
  const numberTimestamps = gameNumber === 2 ? week?.game2NumberTimestamps : week?.numberTimestamps;

  return reply.status(201).send({
    soloGameId: game.id,
    weekId: game.weekId,
    gameNumber: game.gameNumber,
    ticket: game.ticket,
    numberSequence: game.numberSequence,
    status: game.status,
    videoUrl: videoUrl || null,
    videoId: videoId || null,
    numberTimestamps: numberTimestamps || [],
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
  const { game1, game2, week } = await getUserCurrentWeekGames(userId);

  const formatGame = (game: NonNullable<typeof game1>) => ({
    id: game.id,
    weekId: game.weekId,
    gameNumber: game.gameNumber,
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
  });

  // Compute game2Status for the frontend
  let game2Status: {
    available: boolean;
    cooldownEndsAt: string | null;
    configured: boolean;
  } = {
    available: false,
    cooldownEndsAt: null,
    configured: isGame2Configured(week),
  };

  if (game1?.status === 'COMPLETED' && game1.completedAt && isGame2Configured(week)) {
    const cooldownEnd = new Date(game1.completedAt.getTime() + 24 * 60 * 60 * 1000);
    if (new Date() >= cooldownEnd) {
      game2Status.available = !game2; // Available if not already started
    } else {
      game2Status.cooldownEndsAt = cooldownEnd.toISOString();
    }
  }

  if (!game1) {
    return reply.send({
      game: null,
      game1: null,
      game2: null,
      game2Status,
      canPlay: isSoloGameDay(),
      isSunday: isSunday(),
      isConfigured: isWeekConfigured(week),
      videoUrl: week.videoUrl || null,
      videoId: week.videoId || null,
      numberTimestamps: week.numberTimestamps || [],
      game2VideoUrl: week.game2VideoUrl || null,
      game2VideoId: week.game2VideoId || null,
      game2NumberTimestamps: week.game2NumberTimestamps || [],
      currentWeek: {
        id: week.id,
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        status: week.status,
      },
    });
  }

  return reply.send({
    game: formatGame(game1), // backward compat — Game 1 data
    game1: formatGame(game1),
    game2: game2 ? formatGame(game2) : null,
    game2Status,
    videoUrl: week.videoUrl || null,
    videoId: week.videoId || null,
    numberTimestamps: week.numberTimestamps || [],
    game2VideoUrl: week.game2VideoUrl || null,
    game2VideoId: week.game2VideoId || null,
    game2NumberTimestamps: week.game2NumberTimestamps || [],
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
  const { weekId, gameNumber: gameNumberStr } = (request.query as any) || {};
  const gameNumber = gameNumberStr ? parseInt(gameNumberStr, 10) : 1;

  let week;
  if (weekId) {
    week = await prisma.soloWeek.findUnique({ where: { id: weekId } });
    if (!week) throw new AppError('WEEK_NOT_FOUND', 'Week not found', 404);
  } else {
    week = await getOrCreateCurrentWeek();
  }

  if (week.status === 'FINALIZED') {
    // Return finalized winners for the specified game number
    const winners = await prisma.soloWeeklyWinner.findMany({
      where: { weekId: week.id, gameNumber },
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

  // Live leaderboard — best claims per category for the specified game number
  const categories = ['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE'] as const;
  const leaderboard = [];

  for (const category of categories) {
    const bestClaim = await prisma.soloClaim.findFirst({
      where: {
        category,
        soloGame: { weekId: week.id, gameNumber },
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

  // Count total players for this game number
  const playerCount = await prisma.soloGame.count({ where: { weekId: week.id, gameNumber } });

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
 * GET /api/v1/solo/category-rankings?userId=xxx&weekId=xxx
 * Returns top 10 claimers per category + requesting user's rank.
 */
export async function getCategoryRankings(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request);
  const { weekId, gameNumber: gameNumberStr } = (request.query as any) || {};
  const gameNumber = gameNumberStr ? parseInt(gameNumberStr, 10) : 1;

  let week;
  if (weekId) {
    week = await prisma.soloWeek.findUnique({ where: { id: weekId } });
    if (!week) throw new AppError('WEEK_NOT_FOUND', 'Week not found', 404);
  } else {
    week = await getOrCreateCurrentWeek();
  }

  const categories = ['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE'] as const;
  const rankings: Record<string, any[]> = {};
  const userRanks: Record<string, number | null> = {};
  const totalClaimers: Record<string, number> = {};

  for (const category of categories) {
    // Get all claims for this category this week for the specified game number
    const allClaims = await prisma.soloClaim.findMany({
      where: {
        category,
        soloGame: { weekId: week.id, gameNumber },
      },
      orderBy: [
        { numberCountAtClaim: 'asc' },
        { claimedAt: 'asc' },
      ],
      include: {
        soloGame: { select: { userId: true } },
      },
    });

    totalClaimers[category] = allClaims.length;

    // Find user's rank
    const userIndex = allClaims.findIndex(c => c.soloGame.userId === userId);
    userRanks[category] = userIndex >= 0 ? userIndex + 1 : null;

    // Get top 10 with user names
    const top10 = allClaims.slice(0, 10);
    const rankedEntries = [];

    for (let i = 0; i < top10.length; i++) {
      const claim = top10[i];
      const user = await prisma.user.findUnique({
        where: { id: claim.soloGame.userId },
        select: { name: true },
      });
      rankedEntries.push({
        rank: i + 1,
        userName: user?.name || 'Anonymous',
        numberCountAtClaim: claim.numberCountAtClaim,
        isCurrentUser: claim.soloGame.userId === userId,
      });
    }

    // If user is outside top 10, add their entry separately
    if (userIndex >= 10) {
      const userClaim = allClaims[userIndex];
      const user = await prisma.user.findUnique({
        where: { id: userClaim.soloGame.userId },
        select: { name: true },
      });
      rankedEntries.push({
        rank: userIndex + 1,
        userName: user?.name || 'Anonymous',
        numberCountAtClaim: userClaim.numberCountAtClaim,
        isCurrentUser: true,
      });
    }

    rankings[category] = rankedEntries;
  }

  return reply.send({ rankings, userRanks, totalClaimers });
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

  const { videoUrl, numberSequence, numberTimestamps, gameNumber } = parsed.data;

  // Extract YouTube video ID
  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    throw new AppError('INVALID_VIDEO_URL', 'Could not extract YouTube video ID from URL', 400);
  }

  const week = await getOrCreateCurrentWeek();

  if (gameNumber === 2) {
    const updated = await configureSoloWeekGame2Video(week.id, {
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
        game2VideoUrl: updated.game2VideoUrl,
        game2VideoId: updated.game2VideoId,
        game2NumberSequence: updated.game2NumberSequence,
        game2NumberTimestamps: updated.game2NumberTimestamps,
        game2ConfiguredAt: updated.game2ConfiguredAt,
      },
    });
  }

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

  const game2Count = await prisma.soloGame.count({ where: { weekId: week.id, gameNumber: 2 } });

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
      // Game 2 config
      game2VideoUrl: week.game2VideoUrl,
      game2VideoId: week.game2VideoId,
      game2NumberSequence: week.game2NumberSequence,
      game2NumberTimestamps: week.game2NumberTimestamps,
      game2VideoStartTime: week.game2VideoStartTime,
      game2ConfiguredAt: week.game2ConfiguredAt,
      game2ConfiguredBy: week.game2ConfiguredBy,
    },
    gameCount,
    game2Count,
    isConfigured: isWeekConfigured(week),
    isGame2Configured: isGame2Configured(week),
    canReconfigure: gameCount === 0,
    canReconfigureGame2: game2Count === 0,
  });
}

/**
 * Admin endpoint to force-unlock Game 2 for a user by backdating Game 1 completedAt.
 * POST /api/v1/solo/admin/unlock-game2
 * Body: { userId: string }
 */
export async function adminUnlockGame2(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { userId } = request.body as { userId: string };
  if (!userId) {
    return reply.status(400).send({ error: 'userId is required' });
  }

  const game1 = await prisma.soloGame.findFirst({
    where: { userId, gameNumber: 1, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
  });

  if (!game1) {
    return reply.status(404).send({ error: 'No completed Game 1 found for this user' });
  }

  const updated = await prisma.soloGame.update({
    where: { id: game1.id },
    data: { completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
  });

  return reply.send({
    success: true,
    message: `Game 1 completedAt backdated to 25 hours ago for user ${userId}`,
    gameId: updated.id,
    newCompletedAt: updated.completedAt,
  });
}
