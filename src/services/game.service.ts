import { redis } from '../database/redis.js';
import { logger } from '../utils/logger.js';
import { Game, GameStatus, Player, Winner, WinCategory } from '../models/index.js';

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

  // Fallback to MongoDB
  const game = await Game.findById(gameId).select('status calledNumbers currentNumber');

  if (!game) {
    return null;
  }

  // Get player count
  const playerCount = await Player.countDocuments({ gameId });

  // Get won categories
  const winners = await Winner.find({ gameId }).distinct('category');

  return {
    gameId: game._id.toString(),
    status: game.status,
    calledNumbers: game.calledNumbers,
    currentNumber: game.currentNumber ?? null,
    wonCategories: new Set(winners as WinCategory[]),
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

  if (calledNumbers.includes(number)) {
    throw new Error('Number already called');
  }

  calledNumbers.push(number);

  await redis.hmset(key, {
    calledNumbers: JSON.stringify(calledNumbers),
    currentNumber: number.toString(),
  });

  // Also update MongoDB
  await Game.findByIdAndUpdate(gameId, {
    calledNumbers,
    currentNumber: number,
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

  await Game.findByIdAndUpdate(gameId, updateData);

  logger.info({ gameId, status }, 'Game status updated');

  // If game completed, sync Redis to MongoDB and cleanup
  if (status === GameStatus.COMPLETED) {
    await syncGameStateToDatabase(gameId);
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

  await Game.findByIdAndUpdate(gameId, {
    calledNumbers: gameState.calledNumbers,
    currentNumber: gameState.currentNumber,
  });

  logger.info({ gameId }, 'Game state synced to MongoDB');

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
