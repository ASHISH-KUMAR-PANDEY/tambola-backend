import { prisma, WinCategory } from '../models/index.js';
import { generateTicket, getRowNumbers, getTicketNumbers } from './ticket.service.js';
import type { TicketPoolEntry } from './ticket.service.js';
import { getOrCreateCurrentWeek, isSoloGameDay, isWeekConfigured, isGame2Configured } from './solo-week.service.js';
import { AppError } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { redis } from '../database/redis.js';

/**
 * Gets a ticket from the pre-generated optimized pool (round-robin via Redis counter).
 * Falls back to random generateTicket() if pool doesn't exist.
 */
async function getTicketFromPool(weekId: string, gameNumber: number, pool: TicketPoolEntry[] | null): Promise<number[][]> {
  if (!pool || !Array.isArray(pool) || pool.length === 0) {
    logger.info({ weekId, gameNumber, ticketSource: 'random_fallback' }, 'No ticket pool, using random ticket');
    return generateTicket();
  }

  try {
    const key = `solo:ticket_pool:${weekId}:${gameNumber}:idx`;
    const idx = await redis.incr(key);
    // Set TTL of 8 days on first use
    if (idx === 1) await redis.expire(key, 8 * 86400);
    const poolIndex = (idx - 1) % pool.length;
    const entry = pool[poolIndex];
    logger.info({
      weekId, gameNumber, poolIndex, poolSize: pool.length,
      ticketSource: 'optimized_pool',
      expected: { e5: entry.e5, tl: entry.tl, ml: entry.ml, bl: entry.bl, fh: entry.fh },
    }, 'Assigned ticket from optimized pool');
    return entry.ticket;
  } catch (err) {
    logger.error({ weekId, gameNumber, ticketSource: 'random_fallback', error: err }, 'Redis pool counter failed, using random ticket');
    return generateTicket();
  }
}

/**
 * Generates a shuffled sequence of numbers 1-90 using Fisher-Yates.
 */
export function generateNumberSequence(): number[] {
  const arr = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Starts a new solo game for the user.
 * gameNumber=1: standard Game 1 (existing logic)
 * gameNumber=2: Game 2 (requires Game 1 completed + 24hr cooldown + Game 2 configured)
 */
export async function startSoloGame(userId: string, gameNumber: number = 1) {
  if (!isSoloGameDay()) {
    throw new AppError('SUNDAY_NO_GAMES', 'Solo games cannot be started on Sunday. Check back Monday!', 400);
  }

  const week = await getOrCreateCurrentWeek();

  if (gameNumber === 2) {
    // Game 2 validation
    if (!isGame2Configured(week)) {
      throw new AppError('GAME2_NOT_CONFIGURED', 'Game 2 has not been configured for this week.', 400);
    }

    // Game 1 must be completed
    const game1 = await prisma.soloGame.findUnique({
      where: { userId_weekId_gameNumber: { userId, weekId: week.id, gameNumber: 1 } },
    });
    if (!game1 || game1.status !== 'COMPLETED') {
      throw new AppError('GAME1_NOT_COMPLETED', 'You must complete Game 1 before playing Game 2.', 400);
    }

    // 24-hour cooldown check
    if (game1.completedAt) {
      const cooldownEnd = new Date(game1.completedAt.getTime() + 24 * 60 * 60 * 1000);
      if (new Date() < cooldownEnd) {
        throw new AppError('COOLDOWN_ACTIVE', 'Game 2 is still locked. Please wait for the cooldown to expire.', 400);
      }
    }

    // Check if Game 2 already exists
    const existingGame2 = await prisma.soloGame.findUnique({
      where: { userId_weekId_gameNumber: { userId, weekId: week.id, gameNumber: 2 } },
    });
    if (existingGame2) {
      throw new AppError('ALREADY_PLAYED', 'You have already started Game 2 this week', 409);
    }

    const ticket = await getTicketFromPool(week.id, 2, week.game2TicketPool as unknown as TicketPoolEntry[] | null);
    const numberSequence = week.game2NumberSequence;

    const game = await prisma.soloGame.create({
      data: {
        userId,
        weekId: week.id,
        gameNumber: 2,
        ticket: ticket as any,
        numberSequence,
        status: 'IN_PROGRESS',
      },
      include: { claims: true, week: true },
    });

    logger.info({ userId, soloGameId: game.id, weekId: week.id, gameNumber: 2 }, 'Solo Game 2 started');
    return game;
  }

  // Game 1 (existing logic)
  if (!isWeekConfigured(week)) {
    throw new AppError('WEEK_NOT_CONFIGURED', 'This week has not been set up yet. Please wait for the organizer to configure the game.', 400);
  }

  // Check if user already has a Game 1 this week
  const existing = await prisma.soloGame.findUnique({
    where: { userId_weekId_gameNumber: { userId, weekId: week.id, gameNumber: 1 } },
  });

  if (existing) {
    throw new AppError('ALREADY_PLAYED', 'You have already played a solo game this week', 409);
  }

  const ticket = await getTicketFromPool(week.id, 1, week.ticketPool as unknown as TicketPoolEntry[] | null);
  // Use the week's shared number sequence (from the video) instead of random per-user
  const numberSequence = week.numberSequence;

  const game = await prisma.soloGame.create({
    data: {
      userId,
      weekId: week.id,
      gameNumber: 1,
      ticket: ticket as any,
      numberSequence,
      status: 'IN_PROGRESS',
    },
    include: { claims: true, week: true },
  });

  logger.info({ userId, soloGameId: game.id, weekId: week.id }, 'Solo game started');

  return game;
}

/**
 * Validates a win claim and records it.
 */
export async function validateAndRecordClaim(
  soloGameId: string,
  userId: string,
  category: WinCategory,
  currentNumberIndex: number
) {
  const game = await prisma.soloGame.findUnique({
    where: { id: soloGameId },
    include: { claims: true },
  });

  if (!game) throw new AppError('GAME_NOT_FOUND', 'Solo game not found', 404);
  if (game.userId !== userId) throw new AppError('NOT_YOUR_GAME', 'This is not your game', 403);
  if (game.status !== 'IN_PROGRESS') throw new AppError('GAME_NOT_ACTIVE', 'Game is not in progress', 400);

  // Validate index bounds
  if (currentNumberIndex < 0 || currentNumberIndex > 89) {
    throw new AppError('INVALID_INDEX', 'Invalid number index', 400);
  }

  // Check category not already claimed
  const alreadyClaimed = game.claims.some(c => c.category === category);
  if (alreadyClaimed) {
    throw new AppError('ALREADY_CLAIMED', `${category} has already been claimed`, 409);
  }

  // Extract called numbers up to currentNumberIndex (inclusive)
  const calledNumbers = game.numberSequence.slice(0, currentNumberIndex + 1);
  const calledSet = new Set(calledNumbers);

  // Extract ticket
  const ticket = game.ticket as number[][];

  // Validate the claim
  const isValid = validateClaimPattern(ticket, calledSet, category);
  if (!isValid) {
    throw new AppError('INVALID_CLAIM', `Claim for ${category} is not valid at this point`, 400);
  }

  const numberCountAtClaim = currentNumberIndex + 1; // 1-indexed

  const claim = await prisma.soloClaim.create({
    data: {
      soloGameId,
      category,
      numberCountAtClaim,
    },
  });

  logger.info({ soloGameId, userId, category, numberCountAtClaim }, 'Solo claim recorded');

  // Check if all 5 categories are now claimed
  const totalClaims = game.claims.length + 1;
  const gameComplete = totalClaims >= 5;

  if (gameComplete) {
    await prisma.soloGame.update({
      where: { id: soloGameId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    logger.info({ soloGameId, userId }, 'Solo game auto-completed (all categories claimed)');
  }

  return { claim, gameComplete };
}

/**
 * Validates if a claim pattern is complete given the called numbers.
 */
function validateClaimPattern(
  ticket: number[][],
  calledSet: Set<number>,
  category: WinCategory
): boolean {
  const allTicketNums = getTicketNumbers(ticket);
  const markedTicketNums = allTicketNums.filter(n => calledSet.has(n));

  switch (category) {
    case 'EARLY_5':
      return markedTicketNums.length >= 5;
    case 'TOP_LINE':
      return getRowNumbers(ticket, 0).every(n => calledSet.has(n));
    case 'MIDDLE_LINE':
      return getRowNumbers(ticket, 1).every(n => calledSet.has(n));
    case 'BOTTOM_LINE':
      return getRowNumbers(ticket, 2).every(n => calledSet.has(n));
    case 'FULL_HOUSE':
      return allTicketNums.every(n => calledSet.has(n));
    default:
      return false;
  }
}

/**
 * Gets user's current week games (Game 1 and optionally Game 2).
 */
export async function getUserCurrentWeekGames(userId: string) {
  const week = await getOrCreateCurrentWeek();

  const game1 = await prisma.soloGame.findUnique({
    where: { userId_weekId_gameNumber: { userId, weekId: week.id, gameNumber: 1 } },
    include: { claims: true },
  });

  const game2 = await prisma.soloGame.findUnique({
    where: { userId_weekId_gameNumber: { userId, weekId: week.id, gameNumber: 2 } },
    include: { claims: true },
  });

  return { game1, game2, week };
}

/**
 * Updates game progress (currentIndex + markedNumbers) for resume support.
 */
export async function updateGameProgress(
  soloGameId: string,
  userId: string,
  currentIndex: number,
  markedNumbers: number[]
): Promise<void> {
  const game = await prisma.soloGame.findUnique({ where: { id: soloGameId } });
  if (!game) throw new AppError('GAME_NOT_FOUND', 'Solo game not found', 404);
  if (game.userId !== userId) throw new AppError('NOT_YOUR_GAME', 'This is not your game', 403);
  if (game.status !== 'IN_PROGRESS') return; // Silently ignore for completed games

  await prisma.soloGame.update({
    where: { id: soloGameId },
    data: {
      currentIndex,
      markedNumbers,
    },
  });
}

/**
 * Marks the game as completed when all 90 numbers have been called.
 */
export async function completeGame(
  soloGameId: string,
  userId: string,
  markedNumbers: number[]
): Promise<void> {
  const game = await prisma.soloGame.findUnique({ where: { id: soloGameId } });
  if (!game) throw new AppError('GAME_NOT_FOUND', 'Solo game not found', 404);
  if (game.userId !== userId) throw new AppError('NOT_YOUR_GAME', 'This is not your game', 403);
  if (game.status === 'COMPLETED') return; // Already complete

  await prisma.soloGame.update({
    where: { id: soloGameId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      currentIndex: 90,
      markedNumbers,
    },
  });

  logger.info({ soloGameId, userId }, 'Solo game completed');
}
