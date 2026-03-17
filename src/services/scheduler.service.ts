import { prisma, GameMode, GameStatus } from '../models/index.js';
import { revealNextNumber } from './weekly-game.service.js';
import { logger } from '../utils/logger.js';

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Starts the weekly game scheduler
 * Checks every 60 seconds if any weekly game needs a number revealed
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    logger.warn('Scheduler already running');
    return;
  }

  logger.info('Starting weekly game scheduler (checks every 60s)');

  schedulerInterval = setInterval(async () => {
    try {
      await checkAndRevealNumbers();
    } catch (error) {
      logger.error({ error }, 'Scheduler error');
    }
  }, 60_000); // Check every minute

  // Also run immediately on startup
  checkAndRevealNumbers().catch((error) => {
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
 * Checks all active weekly games and reveals numbers if interval has passed
 */
async function checkAndRevealNumbers(): Promise<void> {
  const activeWeeklyGames = await prisma.game.findMany({
    where: {
      gameMode: GameMode.WEEKLY,
      status: GameStatus.ACTIVE,
    },
    select: {
      id: true,
      revealedCount: true,
      revealIntervalMin: true,
      lastRevealedAt: true,
      resultDate: true,
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

    // All numbers revealed
    if (game.revealedCount >= game.numberSequence.length) {
      continue;
    }

    // Check if enough time has passed since last reveal
    const intervalMs = (game.revealIntervalMin || 120) * 60 * 1000;
    const lastReveal = game.lastRevealedAt || new Date(0);
    const elapsed = now.getTime() - lastReveal.getTime();

    if (elapsed >= intervalMs) {
      const number = await revealNextNumber(game.id);
      if (number !== null) {
        logger.info({ gameId: game.id, number, elapsed: Math.round(elapsed / 60000) }, 'Scheduler revealed number');
      }
    }
  }
}
