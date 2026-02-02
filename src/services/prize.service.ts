import { prisma, QueueStatus, WinCategory } from '../models/index.js';
import { logger } from '../utils/logger.js';

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

export interface PrizeDistributionInput {
  userId: string;
  gameId: string;
  category: WinCategory;
  prizeValue: any; // JSON value from game.prizes
}

/**
 * Adds a prize to the distribution queue
 * CRITICAL: This persists to database FIRST (architectural law)
 * IDEMPOTENT: Uses unique constraint to prevent duplicates
 */
export async function enqueuePrize(
  input: PrizeDistributionInput
): Promise<string> {
  try {
    // Generate idempotency key for external API
    const idempotencyKey = `${input.gameId}-${input.userId}-${input.category}-${Date.now()}`;

    const prizeQueue = await prisma.prizeQueue.create({
      data: {
        userId: input.userId,
        gameId: input.gameId,
        category: input.category,
        prizeValue: input.prizeValue,
        status: QueueStatus.PENDING,
        idempotencyKey,
      },
    });

    logger.info(
      { prizeQueueId: prizeQueue.id, userId: input.userId, category: input.category },
      'Prize enqueued'
    );

    // Process immediately (async)
    processPrizeQueue(prizeQueue.id).catch((error) => {
      logger.error(
        { error, prizeQueueId: prizeQueue.id },
        'Failed to process prize queue'
      );
    });

    return prizeQueue.id;
  } catch (error: any) {
    // Handle duplicate prize (idempotent behavior)
    if (error.code === 'P2002') {
      logger.warn(
        { userId: input.userId, gameId: input.gameId, category: input.category },
        'Prize already enqueued (duplicate prevented)'
      );

      // Return existing prize queue ID
      const existing = await prisma.prizeQueue.findUnique({
        where: {
          userId_gameId_category: {
            userId: input.userId,
            gameId: input.gameId,
            category: input.category,
          },
        },
      });

      return existing?.id || '';
    }

    logger.error({ error, input }, 'Failed to enqueue prize');
    throw error;
  }
}

/**
 * Processes a prize queue item with retry logic
 */
async function processPrizeQueue(prizeQueueId: string): Promise<void> {
  const prizeQueue = await prisma.prizeQueue.findUnique({
    where: { id: prizeQueueId },
  });

  if (!prizeQueue || prizeQueue.status !== QueueStatus.PENDING) {
    return;
  }

  // Mark as processing
  await prisma.prizeQueue.update({
    where: { id: prizeQueueId },
    data: { status: QueueStatus.PROCESSING },
  });

  try {
    // Call external prize distribution API with idempotency key
    await distributePrizeExternal(
      prizeQueue.userId,
      prizeQueue.category as WinCategory,
      prizeQueue.prizeValue,
      prizeQueue.idempotencyKey || undefined
    );

    // Mark as completed
    await prisma.prizeQueue.update({
      where: { id: prizeQueueId },
      data: { status: QueueStatus.COMPLETED },
    });

    logger.info({ prizeQueueId }, 'Prize distributed successfully');
  } catch (error) {
    logger.error({ error, prizeQueueId }, 'Prize distribution failed');

    // Retry logic
    const attempts = prizeQueue.attempts + 1;

    if (attempts >= MAX_RETRY_ATTEMPTS) {
      // Move to dead letter queue
      await prisma.prizeQueue.update({
        where: { id: prizeQueueId },
        data: {
          status: QueueStatus.DEAD_LETTER,
          attempts,
          lastAttempt: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      logger.error({ prizeQueueId }, 'Prize moved to dead letter queue');

      // TODO: Send alert to monitoring system (e.g., Slack webhook)
    } else {
      // Schedule retry
      await prisma.prizeQueue.update({
        where: { id: prizeQueueId },
        data: {
          status: QueueStatus.PENDING,
          attempts,
          lastAttempt: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      const delay = RETRY_DELAYS[attempts - 1] || 30000;
      logger.warn(
        { prizeQueueId, attempts, delay },
        'Prize distribution will retry'
      );

      setTimeout(() => {
        processPrizeQueue(prizeQueueId).catch((err) => {
          logger.error({ error: err, prizeQueueId }, 'Retry processing failed');
        });
      }, delay);
    }
  }
}

/**
 * Calls external prize distribution API with idempotency key
 * For MVP, this is a mock that simulates the external API
 */
async function distributePrizeExternal(
  userId: string,
  category: WinCategory,
  prizeValue: any,
  idempotencyKey?: string
): Promise<void> {
  // TODO: Replace with actual external API call to STAGE platform
  // Example: await fetch('https://stage-api.com/subscriptions/extend', {
  //   headers: { 'Idempotency-Key': idempotencyKey },
  //   ...
  // })

  logger.info(
    { userId, category, prizeValue, idempotencyKey },
    'Mock: Distributing prize to external API'
  );

  // Simulate API call delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Simulate 10% failure rate for testing retry logic
  if (Math.random() < 0.1) {
    throw new Error('External API call failed (mock failure)');
  }
}

/**
 * Gets pending prize queue items for manual intervention
 */
export async function getPendingPrizes(gameId?: string): Promise<any[]> {
  const where: any = {
    status: { in: [QueueStatus.PENDING, QueueStatus.PROCESSING, QueueStatus.DEAD_LETTER] },
  };

  if (gameId) {
    where.gameId = gameId;
  }

  const prizes = await prisma.prizeQueue.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return prizes;
}

/**
 * Manually retries a failed prize distribution
 */
export async function retryPrize(prizeQueueId: string): Promise<void> {
  const prizeQueue = await prisma.prizeQueue.findUnique({
    where: { id: prizeQueueId },
  });

  if (!prizeQueue || prizeQueue.status === QueueStatus.COMPLETED) {
    throw new Error('Prize queue not found or already completed');
  }

  await prisma.prizeQueue.update({
    where: { id: prizeQueueId },
    data: {
      status: QueueStatus.PENDING,
      attempts: 0,
      error: null,
    },
  });

  await processPrizeQueue(prizeQueueId);
}
