import { prisma, GameStatus, GameMode, WinCategory } from '../models/index.js';
import { generateTicket, getTicketNumbers, getRowNumbers } from './ticket.service.js';
import { logger } from '../utils/logger.js';

/**
 * Generates a shuffled sequence of numbers 1-90
 */
function generateNumberSequence(): number[] {
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

/**
 * Creates a weekly game with pre-generated number sequence
 */
export async function createWeeklyGame(data: {
  createdBy: string;
  prizes: any;
  revealIntervalMin: number;
  resultDate: string;
}) {
  const numberSequence = generateNumberSequence();
  const now = new Date();

  const game = await prisma.game.create({
    data: {
      scheduledTime: now,
      startedAt: now,
      createdBy: data.createdBy,
      prizes: data.prizes,
      gameMode: GameMode.WEEKLY,
      status: GameStatus.ACTIVE,
      numberSequence,
      revealedCount: 0,
      revealIntervalMin: data.revealIntervalMin,
      lastRevealedAt: now,
      resultDate: new Date(data.resultDate),
      isPublic: true,
    },
  });

  logger.info({ gameId: game.id, revealInterval: data.revealIntervalMin }, 'Weekly game created');
  return game;
}

/**
 * Gets revealed numbers for a weekly game
 */
export function getRevealedNumbers(game: { numberSequence: number[]; revealedCount: number }): number[] {
  return game.numberSequence.slice(0, game.revealedCount);
}

/**
 * Reveals the next number in the sequence
 */
export async function revealNextNumber(gameId: string): Promise<number | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { numberSequence: true, revealedCount: true, status: true, gameMode: true },
  });

  if (!game || game.gameMode !== GameMode.WEEKLY || game.status !== GameStatus.ACTIVE) {
    return null;
  }

  if (game.revealedCount >= game.numberSequence.length) {
    return null; // All 90 numbers revealed
  }

  const nextNumber = game.numberSequence[game.revealedCount];
  const newRevealedCount = game.revealedCount + 1;
  const revealedNumbers = game.numberSequence.slice(0, newRevealedCount);

  await prisma.game.update({
    where: { id: gameId },
    data: {
      revealedCount: newRevealedCount,
      calledNumbers: revealedNumbers,
      currentNumber: nextNumber,
      lastRevealedAt: new Date(),
    },
  });

  logger.info({ gameId, number: nextNumber, revealedCount: newRevealedCount }, 'Weekly number revealed');
  return nextNumber;
}

/**
 * Reveals multiple numbers at once (for daily 15-number reveal)
 */
export async function revealDailyNumbers(gameId: string, count: number): Promise<number[]> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { numberSequence: true, revealedCount: true, status: true, gameMode: true },
  });

  if (!game || game.gameMode !== GameMode.WEEKLY || game.status !== GameStatus.ACTIVE) {
    return [];
  }

  const remaining = game.numberSequence.length - game.revealedCount;
  const toReveal = Math.min(count, remaining);
  if (toReveal <= 0) return [];

  const newRevealedCount = game.revealedCount + toReveal;
  const revealedNumbers = game.numberSequence.slice(0, newRevealedCount);
  const newNumbers = game.numberSequence.slice(game.revealedCount, newRevealedCount);
  const lastNumber = revealedNumbers[revealedNumbers.length - 1];

  await prisma.game.update({
    where: { id: gameId },
    data: {
      revealedCount: newRevealedCount,
      calledNumbers: revealedNumbers,
      currentNumber: lastNumber,
      lastRevealedAt: new Date(),
    },
  });

  logger.info({ gameId, count: toReveal, totalRevealed: newRevealedCount }, 'Daily numbers revealed');
  return newNumbers;
}

/**
 * Join a weekly game — creates a Player record with a ticket
 */
export async function joinWeeklyGame(gameId: string, userId: string, userName: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, status: true, gameMode: true, resultDate: true },
  });

  if (!game) throw new Error('Game not found');
  if (game.gameMode !== GameMode.WEEKLY) throw new Error('Not a weekly game');
  if (game.status !== GameStatus.ACTIVE) throw new Error('Game is not active');

  // Check if result date has passed
  if (game.resultDate && new Date() > game.resultDate) {
    throw new Error('Game has ended, results are being calculated');
  }

  // Check if player already joined
  const existing = await prisma.player.findUnique({
    where: { gameId_userId: { gameId, userId } },
  });

  if (existing) {
    return existing;
  }

  const ticket = generateTicket();

  const player = await prisma.player.create({
    data: {
      gameId,
      userId,
      userName,
      ticket: ticket as any,
    },
  });

  logger.info({ gameId, playerId: player.id, userId }, 'Player joined weekly game');
  return player;
}

/**
 * Get a player's full state in a weekly game
 */
export async function getWeeklyPlayerState(gameId: string, userId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      status: true,
      gameMode: true,
      prizes: true,
      numberSequence: true,
      revealedCount: true,
      revealIntervalMin: true,
      lastRevealedAt: true,
      resultDate: true,
      startedAt: true,
    },
  });

  if (!game) throw new Error('Game not found');

  const player = await prisma.player.findUnique({
    where: { gameId_userId: { gameId, userId } },
  });

  if (!player) throw new Error('Player not found in this game');

  // Get marked numbers from DB
  const markedRecords = await prisma.weeklyMarkedNumber.findMany({
    where: { gameId, playerId: player.id },
    select: { number: true },
  });
  const markedNumbers = markedRecords.map((r) => r.number);

  // Get revealed numbers
  const revealedNumbers = game.numberSequence.slice(0, game.revealedCount);

  // Find missed numbers (revealed but not marked, and on player's ticket)
  const ticketNumbers = getTicketNumbers(player.ticket as number[][]);
  const markedSet = new Set(markedNumbers);
  const missedNumbers = revealedNumbers.filter(
    (n) => ticketNumbers.includes(n) && !markedSet.has(n)
  );

  // Get claims
  const claims = await prisma.weeklyPlayerState.findMany({
    where: { gameId, playerId: player.id },
  });

  // Get all winners for this game (to show which categories are taken)
  const allClaims = await prisma.weeklyPlayerState.findMany({
    where: { gameId },
    select: { category: true, playerId: true },
  });

  // Today's numbers = the batch revealed today
  // Day 1 = numbers 0-14, Day 2 = 15-29, etc.
  const startTime = game.startedAt ? new Date(game.startedAt).getTime() : Date.now();
  const elapsedMs = Date.now() - startTime;
  const daysPassed = Math.floor(elapsedMs / (24 * 60 * 60 * 1000)); // 0-indexed day
  const todayStart = daysPassed * 15;
  const todayEnd = Math.min((daysPassed + 1) * 15, game.revealedCount);
  const todayNumbers = todayEnd > todayStart
    ? game.numberSequence.slice(todayStart, todayEnd)
    : [];

  return {
    game: {
      id: game.id,
      status: game.status,
      prizes: game.prizes,
      revealedCount: game.revealedCount,
      revealIntervalMin: game.revealIntervalMin,
      lastRevealedAt: game.lastRevealedAt,
      resultDate: game.resultDate,
      startedAt: game.startedAt,
    },
    player: {
      id: player.id,
      ticket: player.ticket,
      markedNumbers,
      missedNumbers,
    },
    revealedNumbers,
    todayNumbers,
    currentNumber: revealedNumbers.length > 0 ? revealedNumbers[revealedNumbers.length - 1] : null,
    claims: claims.map((c) => ({ category: c.category, completedAtCall: c.completedAtCall, claimedAt: c.claimedAt })),
    wonCategories: [...new Set(allClaims.map((c) => c.category))],
  };
}

/**
 * Mark a number in a weekly game
 */
export async function markWeeklyNumber(gameId: string, userId: string, number: number) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { numberSequence: true, revealedCount: true, gameMode: true, status: true },
  });

  if (!game) throw new Error('Game not found');
  if (game.gameMode !== GameMode.WEEKLY) throw new Error('Not a weekly game');
  if (game.status !== GameStatus.ACTIVE) throw new Error('Game is not active');

  // Validate number has been revealed
  const revealedNumbers = game.numberSequence.slice(0, game.revealedCount);
  if (!revealedNumbers.includes(number)) {
    throw new Error('Number has not been revealed yet');
  }

  const player = await prisma.player.findUnique({
    where: { gameId_userId: { gameId, userId } },
  });

  if (!player) throw new Error('Player not found');

  // Validate number is on player's ticket
  const ticketNumbers = getTicketNumbers(player.ticket as number[][]);
  if (!ticketNumbers.includes(number)) {
    throw new Error('Number is not on your ticket');
  }

  // Upsert (idempotent)
  await prisma.weeklyMarkedNumber.upsert({
    where: {
      gameId_playerId_number: { gameId, playerId: player.id, number },
    },
    create: { gameId, playerId: player.id, number },
    update: {},
  });

  return { success: true };
}

/**
 * Claim a win in a weekly game
 * Uses server timestamp for tie-breaking
 */
export async function claimWeeklyWin(gameId: string, userId: string, category: WinCategory) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { numberSequence: true, revealedCount: true, gameMode: true, status: true },
  });

  if (!game) throw new Error('Game not found');
  if (game.gameMode !== GameMode.WEEKLY) throw new Error('Not a weekly game');
  if (game.status !== GameStatus.ACTIVE) throw new Error('Game is not active');

  const player = await prisma.player.findUnique({
    where: { gameId_userId: { gameId, userId } },
  });

  if (!player) throw new Error('Player not found');

  // Get marked numbers
  const markedRecords = await prisma.weeklyMarkedNumber.findMany({
    where: { gameId, playerId: player.id },
    select: { number: true },
  });
  const markedNumbers = new Set(markedRecords.map((r) => r.number));

  // Validate the claim
  const ticket = player.ticket as number[][];
  const revealedNumbers = game.numberSequence.slice(0, game.revealedCount);
  const revealedSet = new Set(revealedNumbers);

  const isValid = validateWeeklyClaim(ticket, markedNumbers, revealedSet, category);
  if (!isValid) {
    throw new Error('Win condition not met');
  }

  // Calculate at which call number the pattern was completed
  const completedAtCall = calculateCompletedAtCall(ticket, game.numberSequence, category);

  // Check if player already claimed this category
  const existingClaim = await prisma.weeklyPlayerState.findUnique({
    where: { gameId_playerId_category: { gameId, playerId: player.id, category } },
  });

  if (existingClaim) {
    throw new Error('You have already claimed this category');
  }

  // Record the claim with server timestamp
  const claim = await prisma.weeklyPlayerState.create({
    data: {
      gameId,
      playerId: player.id,
      category,
      completedAtCall,
    },
  });

  logger.info({ gameId, playerId: player.id, category, completedAtCall }, 'Weekly win claimed');

  return {
    success: true,
    category,
    completedAtCall,
    claimedAt: claim.claimedAt,
  };
}

/**
 * Validate if a weekly claim is valid
 */
function validateWeeklyClaim(
  ticket: number[][],
  markedNumbers: Set<number>,
  revealedNumbers: Set<number>,
  category: WinCategory
): boolean {
  switch (category) {
    case WinCategory.EARLY_5:
      return markedNumbers.size >= 5;

    case WinCategory.TOP_LINE: {
      const rowNums = getRowNumbers(ticket, 0);
      return rowNums.every((n) => markedNumbers.has(n) && revealedNumbers.has(n));
    }

    case WinCategory.MIDDLE_LINE: {
      const rowNums = getRowNumbers(ticket, 1);
      return rowNums.every((n) => markedNumbers.has(n) && revealedNumbers.has(n));
    }

    case WinCategory.BOTTOM_LINE: {
      const rowNums = getRowNumbers(ticket, 2);
      return rowNums.every((n) => markedNumbers.has(n) && revealedNumbers.has(n));
    }

    case WinCategory.FULL_HOUSE: {
      const allNums = getTicketNumbers(ticket);
      return allNums.every((n) => markedNumbers.has(n) && revealedNumbers.has(n));
    }

    default:
      return false;
  }
}

/**
 * Calculate at which call number a pattern was theoretically completed
 * This is the earliest call index where all required numbers had been revealed
 */
function calculateCompletedAtCall(
  ticket: number[][],
  numberSequence: number[],
  category: WinCategory
): number {
  let requiredNumbers: number[];

  switch (category) {
    case WinCategory.EARLY_5:
      // For Early 5, find the 5th ticket number to be revealed
      const ticketNums = getTicketNumbers(ticket);
      const ticketSet = new Set(ticketNums);
      let count = 0;
      for (let i = 0; i < numberSequence.length; i++) {
        if (ticketSet.has(numberSequence[i])) {
          count++;
          if (count >= 5) return i + 1; // 1-indexed
        }
      }
      return numberSequence.length;

    case WinCategory.TOP_LINE:
      requiredNumbers = getRowNumbers(ticket, 0);
      break;
    case WinCategory.MIDDLE_LINE:
      requiredNumbers = getRowNumbers(ticket, 1);
      break;
    case WinCategory.BOTTOM_LINE:
      requiredNumbers = getRowNumbers(ticket, 2);
      break;
    case WinCategory.FULL_HOUSE:
      requiredNumbers = getTicketNumbers(ticket);
      break;
    default:
      return numberSequence.length;
  }

  // Find the call index when all required numbers have been revealed
  const required = new Set(requiredNumbers);
  let found = 0;
  for (let i = 0; i < numberSequence.length; i++) {
    if (required.has(numberSequence[i])) {
      found++;
      if (found === required.size) return i + 1; // 1-indexed
    }
  }
  return numberSequence.length;
}

/**
 * Calculate results for a weekly game
 * Winner per category = lowest completedAtCall, tie-break by earliest claimedAt
 */
export async function calculateResults(gameId: string) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { gameMode: true, prizes: true, resultDate: true },
  });

  if (!game) throw new Error('Game not found');
  if (game.gameMode !== GameMode.WEEKLY) throw new Error('Not a weekly game');

  const categories: WinCategory[] = [
    WinCategory.EARLY_5,
    WinCategory.TOP_LINE,
    WinCategory.MIDDLE_LINE,
    WinCategory.BOTTOM_LINE,
    WinCategory.FULL_HOUSE,
  ];

  const results: Array<{
    category: WinCategory;
    winnerId: string | null;
    playerName: string | null;
    completedAtCall: number | null;
    claimedAt: Date | null;
  }> = [];

  for (const category of categories) {
    // Get all claims for this category, ordered by completedAtCall ASC, then claimedAt ASC
    const claims = await prisma.weeklyPlayerState.findMany({
      where: { gameId, category },
      orderBy: [
        { completedAtCall: 'asc' },
        { claimedAt: 'asc' },
      ],
      include: { player: { select: { userName: true, userId: true } } },
      take: 1,
    });

    if (claims.length > 0) {
      const winner = claims[0];
      results.push({
        category,
        winnerId: winner.player.userId,
        playerName: winner.player.userName,
        completedAtCall: winner.completedAtCall,
        claimedAt: winner.claimedAt,
      });
    } else {
      results.push({
        category,
        winnerId: null,
        playerName: null,
        completedAtCall: null,
        claimedAt: null,
      });
    }
  }

  return { gameId, prizes: game.prizes, results };
}
