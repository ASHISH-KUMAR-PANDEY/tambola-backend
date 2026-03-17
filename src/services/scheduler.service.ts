import { prisma, GameMode, GameStatus } from '../models/index.js';
import { revealDailyNumbers } from './weekly-game.service.js';
import { logger } from '../utils/logger.js';

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Starts the weekly game scheduler
 * Checks every 60 seconds if any weekly game needs daily numbers revealed
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    logger.warn('Scheduler already running');
    return;
  }

  logger.info('Starting weekly game scheduler (checks every 60s)');

  schedulerInterval = setInterval(async () => {
    try {
      await checkAndRevealDailyNumbers();
    } catch (error) {
      logger.error({ error }, 'Scheduler error');
    }
  }, 60_000); // Check every minute

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
 * Checks all active weekly games and reveals 15 numbers if date has changed
 * Logic: Day 1 = numbers 1-15, Day 2 = 16-30, ..., Day 6 = 76-90
 * Day 7 (Sunday) = result day, no new numbers
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
      lastRevealedAt: true,
      resultDate: true,
      startedAt: true,
      numberSequence: true,
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

    // Calculate how many days have passed since game started
    const startDate = game.startedAt || game.lastRevealedAt || now;
    const daysSinceStart = Math.floor(
      (now.getTime() - new Date(startDate).setHours(0, 0, 0, 0)) / (24 * 60 * 60 * 1000)
    );

    // Each day reveals 15 numbers, max 6 days (90 numbers)
    const expectedRevealed = Math.min(daysSinceStart * 15, 90);

    // If we haven't revealed enough numbers for today, reveal them
    if (game.revealedCount < expectedRevealed) {
      const count = expectedRevealed - game.revealedCount;
      const revealed = await revealDailyNumbers(game.id, count);
      if (revealed.length > 0) {
        logger.info(
          { gameId: game.id, count: revealed.length, totalRevealed: expectedRevealed, day: daysSinceStart },
          'Scheduler revealed daily numbers'
        );
      }
    }
  }
}
