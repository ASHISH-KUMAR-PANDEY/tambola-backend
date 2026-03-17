import { prisma, WinCategory } from '../models/index.js';
import { generateTicket, getRowNumbers, getTicketNumbers } from './ticket.service.js';
import { getOrCreateCurrentWeek, isSoloGameDay, isWeekConfigured } from './solo-week.service.js';
import { AppError } from '../utils/error.js';
import { logger } from '../utils/logger.js';

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
 */
export async function startSoloGame(userId: string) {
  if (!isSoloGameDay()) {
    throw new AppError('SUNDAY_NO_GAMES', 'Solo games cannot be started on Sunday. Check back Monday!', 400);
  }

  const week = await getOrCreateCurrentWeek();

  // Check if week is configured with video data
  if (!isWeekConfigured(week)) {
    throw new AppError('WEEK_NOT_CONFIGURED', 'This week has not been set up yet. Please wait for the organizer to configure the game.', 400);
  }

  // Check if user already has a game this week
  const existing = await prisma.soloGame.findUnique({
    where: { userId_weekId: { userId, weekId: week.id } },
  });

  if (existing) {
    throw new AppError('ALREADY_PLAYED', 'You have already played a solo game this week', 409);
  }

  const ticket = generateTicket();
  // Use the week's shared number sequence (from the video) instead of random per-user
  const numberSequence = week.numberSequence;

  const game = await prisma.soloGame.create({
    data: {
      userId,
      weekId: week.id,
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
 * Gets user's current week game (for resume or completed view).
 */
export async function getUserCurrentWeekGame(userId: string) {
  const week = await getOrCreateCurrentWeek();

  const game = await prisma.soloGame.findUnique({
    where: { userId_weekId: { userId, weekId: week.id } },
    include: { claims: true },
  });

  return { game, week };
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
