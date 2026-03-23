import { prisma, GameMode, GameStatus } from '../models/index.js';
import { revealDailyNumbers } from './weekly-game.service.js';
import { logger } from '../utils/logger.js';

let schedulerInterval: NodeJS.Timeout | null = null;
const NUMBERS_PER_DAY = 15;

/**
 * Starts the weekly game scheduler.
 * Checks every 60s if any weekly game needs its daily batch of 15 numbers revealed.
 * Numbers are revealed once per day — the frontend handles drip animation.
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    logger.warn('Scheduler already running');
    return;
  }

  logger.info('Starting weekly game scheduler (daily batch, checks every 60s)');

  schedulerInterval = setInterval(async () => {
    try {
      await checkAndRevealDailyNumbers();
    } catch (error) {
      logger.error({ error }, 'Scheduler error');
    }
  }, 60_000);

  // Also run immediately on startup
  checkAndRevealDailyNumbers().catch((error) => {
    logger.error({ error }, 'Initial scheduler check failed');
  });
}

/**
 * Stops the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Weekly game scheduler stopped');
  }
}

/**
 * Checks all active weekly games and reveals daily batch of 15 numbers
 * based on how many days have passed since the game started.
 */
async function checkAndRevealDailyNumbers(): Promise<void> {
  const activeWeeklyGames = await prisma.game.findMany({
    where: {
      gameMode: GameMode.WEEKLY,
      status: GameStatus.ACTIVE,
    },
    select: {
      id: true,
      revealedCount: true,
      resultDate: true,
      startedAt: true,
    },
  });

  if (activeWeeklyGames.length === 0) return;

  const now = new Date();

  for (const game of activeWeeklyGames) {
    // Check if result date has passed — complete the game
    if (game.resultDate && now > game.resultDate) {
      await prisma.game.update({
        where: { id: game.id },
        data: { status: GameStatus.COMPLETED, endedAt: now },
      });
      logger.info({ gameId: game.id }, 'Weekly game completed (result date passed)');
      continue;
    }

    // All 90 numbers revealed
    if (game.revealedCount >= 90) {
      continue;
    }

    // Calculate how many numbers should have been revealed by now
    // Day 1 = 15, Day 2 = 30, Day 3 = 45, etc.
    const startTime = game.startedAt || now;
    const elapsedMs = now.getTime() - new Date(startTime).getTime();
    const daysPassed = Math.floor(elapsedMs / (24 * 60 * 60 * 1000)) + 1; // Day 1 starts immediately
    const expectedRevealed = Math.min(90, daysPassed * NUMBERS_PER_DAY);

    if (game.revealedCount < expectedRevealed) {
      const toReveal = expectedRevealed - game.revealedCount;
      const revealed = await revealDailyNumbers(game.id, toReveal);
      logger.info(
        { gameId: game.id, revealed: revealed.length, totalRevealed: expectedRevealed, day: daysPassed },
        'Daily batch revealed'
      );
    }
  }
}
