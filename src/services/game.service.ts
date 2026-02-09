import { redis } from '../database/redis.js';
import { logger } from '../utils/logger.js';
import { prisma, GameStatus, WinCategory } from '../models/index.js';

export interface GameState {
  gameId: string;
  status: GameStatus;
  calledNumbers: number[];
  currentNumber: number | null;
  wonCategories: Set<WinCategory>;
  playerCount: number;
}

/**
 * Initializes game state in Redis when game starts
 */
export async function initializeGameState(gameId: string): Promise<void> {
  const key = `game:${gameId}:state`;

  await redis.hmset(key, {
    status: 'ACTIVE',
    calledNumbers: JSON.stringify([]),
    currentNumber: '',
    wonCategories: JSON.stringify([]),
    playerCount: '0',
  });

  await redis.expire(key, 7200); // 2 hours

  logger.info({ gameId }, 'Game state initialized in Redis');
}

/**
 * Gets game state from Redis (fast) or falls back to PostgreSQL
 */
export async function getGameState(gameId: string): Promise<GameState | null> {
  const key = `game:${gameId}:state`;
  const stateData = await redis.hgetall(key);

  if (stateData && stateData.status) {
    return {
      gameId,
      status: stateData.status as GameStatus,
      calledNumbers: JSON.parse(stateData.calledNumbers || '[]'),
      currentNumber: stateData.currentNumber ? parseInt(stateData.currentNumber, 10) : null,
      wonCategories: new Set(JSON.parse(stateData.wonCategories || '[]')),
      playerCount: parseInt(stateData.playerCount || '0', 10),
    };
  }

  // Fallback to PostgreSQL
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, status: true, calledNumbers: true, currentNumber: true },
  });

  if (!game) {
    return null;
  }

  // Get player count
  const playerCount = await prisma.player.count({
    where: { gameId },
  });

  // Get won categories
  const winners = await prisma.winner.findMany({
    where: { gameId },
    select: { category: true },
    distinct: ['category'],
  });

  return {
    gameId: game.id,
    status: game.status,
    calledNumbers: game.calledNumbers as number[],
    currentNumber: game.currentNumber ?? null,
    wonCategories: new Set(winners.map((w) => w.category as WinCategory)),
    playerCount,
  };
}

/**
 * Calls a number and updates game state
 */
export async function callNumber(
  gameId: string,
  number: number
): Promise<void> {
  const key = `game:${gameId}:state`;
  const stateData = await redis.hgetall(key);

  if (!stateData || !stateData.calledNumbers) {
    throw new Error('Game state not found');
  }

  const calledNumbers: number[] = JSON.parse(stateData.calledNumbers);

  // Use Set for O(1) duplicate check instead of Array.includes() O(n)
  if (new Set(calledNumbers).has(number)) {
    throw new Error('Number already called');
  }

  calledNumbers.push(number);

  await redis.hmset(key, {
    calledNumbers: JSON.stringify(calledNumbers),
    currentNumber: number.toString(),
  });

  // Also update PostgreSQL
  await prisma.game.update({
    where: { id: gameId },
    data: {
      calledNumbers,
      currentNumber: number,
    },
  });

  logger.info({ gameId, number, total: calledNumbers.length }, 'Number called');
}

/**
 * Records a winner for a category
 */
export async function recordWinner(
  gameId: string,
  category: WinCategory
): Promise<void> {
  const key = `game:${gameId}:state`;
  const stateData = await redis.hgetall(key);

  if (!stateData) {
    throw new Error('Game state not found');
  }

  const wonCategories: WinCategory[] = JSON.parse(stateData.wonCategories || '[]');

  if (!wonCategories.includes(category)) {
    wonCategories.push(category);

    await redis.hmset(key, {
      wonCategories: JSON.stringify(wonCategories),
    });
  }
}

/**
 * Increments player count
 */
export async function incrementPlayerCount(gameId: string): Promise<number> {
  const key = `game:${gameId}:state`;
  const newCount = await redis.hincrby(key, 'playerCount', 1);
  return newCount;
}

/**
 * Updates game status
 */
export async function updateGameStatus(
  gameId: string,
  status: GameStatus
): Promise<void> {
  const key = `game:${gameId}:state`;

  await redis.hset(key, 'status', status);

  const updateData: any = { status };

  if (status === GameStatus.ACTIVE) {
    updateData.startedAt = new Date();
  } else if (status === GameStatus.COMPLETED) {
    updateData.endedAt = new Date();
  }

  await prisma.game.update({
    where: { id: gameId },
    data: updateData,
  });

  logger.info({ gameId, status }, 'Game status updated');

  // If game completed, sync Redis to MongoDB and cleanup
  if (status === GameStatus.COMPLETED) {
    await syncGameStateToDatabase(gameId);

    // Clear metadata cache to free memory
    try {
      const { clearGameMetadataCache } = await import('../websocket/handlers/game.handlers.js');
      clearGameMetadataCache(gameId);
    } catch (error) {
      logger.warn({ gameId, error }, 'Failed to clear game metadata cache');
    }
  }
}

/**
 * Syncs game state from Redis to MongoDB (on game completion)
 */
async function syncGameStateToDatabase(gameId: string): Promise<void> {
  const gameState = await getGameState(gameId);

  if (!gameState) {
    logger.warn({ gameId }, 'Cannot sync - game state not found');
    return;
  }

  await prisma.game.update({
    where: { id: gameId },
    data: {
      calledNumbers: gameState.calledNumbers,
      currentNumber: gameState.currentNumber,
    },
  });

  logger.info({ gameId }, 'Game state synced to PostgreSQL');

  // Clean up Redis cache using SCAN (non-blocking)
  const pattern = `game:${gameId}:*`;
  const keys: string[] = [];
  let cursor = '0';

  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');

  if (keys.length > 0) {
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      await redis.del(...batch);
    }
    logger.info({ gameId, keysDeleted: keys.length }, 'Redis cache cleaned up');
  }
}

/**
 * Gets next available number to call (random from remaining)
 */
export async function getNextNumber(gameId: string): Promise<number> {
  const gameState = await getGameState(gameId);

  if (!gameState) {
    throw new Error('Game not found');
  }

  const calledSet = new Set(gameState.calledNumbers);
  const remaining: number[] = [];

  for (let i = 1; i <= 90; i++) {
    if (!calledSet.has(i)) {
      remaining.push(i);
    }
  }

  if (remaining.length === 0) {
    throw new Error('All numbers have been called');
  }

  const randomIndex = Math.floor(Math.random() * remaining.length);
  return remaining[randomIndex];
}
