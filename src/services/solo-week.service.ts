import { prisma, WinCategory, SoloWeekStatus } from '../models/index.js';
import type { SoloWeek } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/error.js';
import { generateOptimizedTicketPool } from './ticket.service.js';

/**
 * Gets the current week bounds (Monday 00:00:00 to Saturday 23:59:59 IST).
 * If today is Sunday, returns the past week (Mon-Sat) since Sunday is results day.
 */
export function getCurrentWeekBounds(): { weekStartDate: Date; weekEndDate: Date } {
  // Get current time in IST
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
  const istNow = new Date(now.getTime() + istOffset);

  // Get day of week in IST (0=Sunday, 1=Monday, ..., 6=Saturday)
  const dayOfWeek = istNow.getUTCDay();

  // Calculate days to subtract to get to Monday
  let daysToMonday: number;
  if (dayOfWeek === 0) {
    // Sunday — use the previous Monday (6 days back)
    daysToMonday = 6;
  } else {
    // Mon=1 → 0, Tue=2 → 1, ..., Sat=6 → 5
    daysToMonday = dayOfWeek - 1;
  }

  // Monday at 00:00:00 IST
  const mondayIST = new Date(istNow);
  mondayIST.setUTCDate(mondayIST.getUTCDate() - daysToMonday);
  mondayIST.setUTCHours(0, 0, 0, 0);

  // Convert Monday IST back to UTC for storage
  const weekStartDate = new Date(mondayIST.getTime() - istOffset);

  // Saturday at 23:59:59.999 IST (5 days after Monday)
  const saturdayIST = new Date(mondayIST);
  saturdayIST.setUTCDate(mondayIST.getUTCDate() + 5);
  saturdayIST.setUTCHours(23, 59, 59, 999);

  const weekEndDate = new Date(saturdayIST.getTime() - istOffset);

  return { weekStartDate, weekEndDate };
}

/**
 * Gets or creates the current week record.
 */
export async function getOrCreateCurrentWeek() {
  const { weekStartDate, weekEndDate } = getCurrentWeekBounds();

  const week = await prisma.soloWeek.upsert({
    where: { weekStartDate },
    update: {},
    create: {
      weekStartDate,
      weekEndDate,
      status: 'ACTIVE',
    },
  });

  return week;
}

/**
 * Returns true if today is Monday through Saturday (IST). Solo games can be played.
 */
export function isSoloGameDay(): boolean {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const dayOfWeek = istNow.getUTCDay(); // 0=Sunday
  return dayOfWeek >= 1 && dayOfWeek <= 6;
}

/**
 * Returns true if today is Sunday (IST) — results day.
 */
export function isSunday(): boolean {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  return istNow.getUTCDay() === 0;
}

/**
 * Finalizes a week: picks winners for each category based on lowest numberCountAtClaim.
 * Tiebreaker: earliest claimedAt timestamp.
 */
export async function finalizeWeek(weekId: string): Promise<void> {
  const week = await prisma.soloWeek.findUnique({ where: { id: weekId } });
  if (!week) throw new Error('Week not found');
  if (week.status === 'FINALIZED') throw new Error('Week already finalized');

  const categories: WinCategory[] = ['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE'];

  // Determine which game numbers to finalize (1 always, 2 only if configured)
  const gameNumbers = [1];
  if (isGame2Configured(week)) {
    gameNumbers.push(2);
  }

  for (const gameNumber of gameNumbers) {
    for (const category of categories) {
      // Find the best claim for this category across games with this gameNumber
      const bestClaim = await prisma.soloClaim.findFirst({
        where: {
          category,
          soloGame: { weekId, gameNumber },
        },
        orderBy: [
          { numberCountAtClaim: 'asc' },
          { claimedAt: 'asc' },
        ],
        include: {
          soloGame: true,
        },
      });

      if (bestClaim) {
        // Get user name
        const user = await prisma.user.findUnique({
          where: { id: bestClaim.soloGame.userId },
          select: { name: true },
        });

        await prisma.soloWeeklyWinner.upsert({
          where: {
            weekId_category_gameNumber: { weekId, category, gameNumber },
          },
          update: {
            userId: bestClaim.soloGame.userId,
            userName: user?.name || null,
            numberCountAtClaim: bestClaim.numberCountAtClaim,
            claimedAt: bestClaim.claimedAt,
          },
          create: {
            weekId,
            category,
            gameNumber,
            userId: bestClaim.soloGame.userId,
            userName: user?.name || null,
            numberCountAtClaim: bestClaim.numberCountAtClaim,
            claimedAt: bestClaim.claimedAt,
          },
        });
      }
    }
  }

  await prisma.soloWeek.update({
    where: { id: weekId },
    data: {
      status: 'FINALIZED',
      finalizedAt: new Date(),
    },
  });

  logger.info({ weekId }, 'Solo week finalized');
}

/**
 * Extracts YouTube video ID from a URL.
 * Supports: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
 */
export function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

/**
 * Checks if a week has been configured with video data (Game 1).
 */
export function isWeekConfigured(week: SoloWeek): boolean {
  return !!(week.videoUrl && week.numberSequence.length === 90 && week.numberTimestamps.length === 90);
}

/**
 * Checks if Game 2 has been configured for the week.
 */
export function isGame2Configured(week: SoloWeek): boolean {
  return !!(week.game2VideoUrl && week.game2NumberSequence.length === 90 && week.game2NumberTimestamps.length === 90);
}

/**
 * Configures the video-based number calling for a week.
 * Called by the organizer. Accepts explicit per-number timestamps.
 */
export async function configureSoloWeekVideo(
  weekId: string,
  config: {
    videoUrl: string;
    videoId: string;
    numberSequence: number[];
    numberTimestamps: number[];
    configuredBy: string;
  }
) {
  const week = await prisma.soloWeek.findUnique({ where: { id: weekId } });
  if (!week) throw new AppError('WEEK_NOT_FOUND', 'Week not found', 404);

  // Validate numberSequence is a valid permutation of 1-90
  if (config.numberSequence.length !== 90) {
    throw new AppError('INVALID_SEQUENCE', 'Number sequence must contain exactly 90 numbers', 400);
  }
  const sorted = [...config.numberSequence].sort((a, b) => a - b);
  for (let i = 0; i < 90; i++) {
    if (sorted[i] !== i + 1) {
      throw new AppError('INVALID_SEQUENCE', 'Number sequence must be a permutation of 1-90', 400);
    }
  }

  // Validate timestamps
  if (config.numberTimestamps.length !== 90) {
    throw new AppError('INVALID_TIMESTAMPS', 'Must provide exactly 90 timestamps', 400);
  }
  for (let i = 0; i < 90; i++) {
    if (config.numberTimestamps[i] < 0) {
      throw new AppError('INVALID_TIMESTAMPS', 'Timestamps must be non-negative', 400);
    }
    // Timestamps should be non-decreasing (each number called at same time or later)
    if (i > 0 && config.numberTimestamps[i] < config.numberTimestamps[i - 1]) {
      throw new AppError('INVALID_TIMESTAMPS', `Timestamp at position ${i + 1} is earlier than position ${i}`, 400);
    }
  }

  const updated = await prisma.soloWeek.update({
    where: { id: weekId },
    data: {
      videoUrl: config.videoUrl,
      videoId: config.videoId,
      numberSequence: config.numberSequence,
      numberTimestamps: config.numberTimestamps,
      videoStartTime: config.numberTimestamps[0] || 0,
      numberInterval: null,
      configuredAt: new Date(),
      configuredBy: config.configuredBy,
    },
  });

  // Auto-generate optimized ticket pool for this sequence
  try {
    const pool = generateOptimizedTicketPool(config.numberSequence, 300);
    if (pool.length >= 100) {
      await prisma.soloWeek.update({
        where: { id: weekId },
        data: { ticketPool: pool as any },
      });
      logger.info({ weekId, poolSize: pool.length }, 'Generated optimized ticket pool');
    } else {
      logger.warn({ weekId, poolSize: pool.length }, 'Ticket pool too small, using random tickets');
    }
  } catch (err) {
    logger.error({ weekId, error: err }, 'Failed to generate ticket pool, will use random tickets');
  }

  logger.info({ weekId, videoUrl: config.videoUrl }, 'Solo week video configured');
  return updated;
}

/**
 * Configures Game 2 video-based number calling for a week.
 * Same validation as Game 1 but writes to game2_ fields.
 */
export async function configureSoloWeekGame2Video(
  weekId: string,
  config: {
    videoUrl: string;
    videoId: string;
    numberSequence: number[];
    numberTimestamps: number[];
    configuredBy: string;
  }
) {
  const week = await prisma.soloWeek.findUnique({ where: { id: weekId } });
  if (!week) throw new AppError('WEEK_NOT_FOUND', 'Week not found', 404);

  // Validate numberSequence is a valid permutation of 1-90
  if (config.numberSequence.length !== 90) {
    throw new AppError('INVALID_SEQUENCE', 'Number sequence must contain exactly 90 numbers', 400);
  }
  const sorted = [...config.numberSequence].sort((a, b) => a - b);
  for (let i = 0; i < 90; i++) {
    if (sorted[i] !== i + 1) {
      throw new AppError('INVALID_SEQUENCE', 'Number sequence must be a permutation of 1-90', 400);
    }
  }

  // Validate timestamps
  if (config.numberTimestamps.length !== 90) {
    throw new AppError('INVALID_TIMESTAMPS', 'Must provide exactly 90 timestamps', 400);
  }
  for (let i = 0; i < 90; i++) {
    if (config.numberTimestamps[i] < 0) {
      throw new AppError('INVALID_TIMESTAMPS', 'Timestamps must be non-negative', 400);
    }
    if (i > 0 && config.numberTimestamps[i] < config.numberTimestamps[i - 1]) {
      throw new AppError('INVALID_TIMESTAMPS', `Timestamp at position ${i + 1} is earlier than position ${i}`, 400);
    }
  }

  const updated = await prisma.soloWeek.update({
    where: { id: weekId },
    data: {
      game2VideoUrl: config.videoUrl,
      game2VideoId: config.videoId,
      game2NumberSequence: config.numberSequence,
      game2NumberTimestamps: config.numberTimestamps,
      game2VideoStartTime: config.numberTimestamps[0] || 0,
      game2ConfiguredAt: new Date(),
      game2ConfiguredBy: config.configuredBy,
    },
  });

  // Auto-generate optimized ticket pool for Game 2
  try {
    const pool = generateOptimizedTicketPool(config.numberSequence, 300);
    if (pool.length >= 100) {
      await prisma.soloWeek.update({
        where: { id: weekId },
        data: { game2TicketPool: pool as any },
      });
      logger.info({ weekId, poolSize: pool.length }, 'Generated Game 2 optimized ticket pool');
    }
  } catch (err) {
    logger.error({ weekId, error: err }, 'Failed to generate Game 2 ticket pool');
  }

  logger.info({ weekId, videoUrl: config.videoUrl }, 'Solo week Game 2 video configured');
  return updated;
}
