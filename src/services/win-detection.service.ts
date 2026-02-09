import { redis } from '../database/redis.js';
import { prisma } from '../database/client.js';
import type { WinCategory } from '@prisma/client';

export interface PlayerTicketState {
  playerId: string;
  userId: string;
  ticket: number[][];  // 3x9 grid structure
  markedNumbers: Set<number>;
  markedCount: number;
}

export interface WinResult {
  playerId: string;
  userId: string;
  category: WinCategory;
}

/**
 * Initializes ticket state in Redis for a player
 */
export async function initializePlayerTicket(
  gameId: string,
  playerId: string,
  userId: string,
  ticket: number[][]  // 3x9 grid
): Promise<void> {
  const key = `game:${gameId}:player:${playerId}:ticket`;

  await redis.hmset(key, {
    userId,
    ticket: JSON.stringify(ticket),
    markedNumbers: JSON.stringify([]),
    markedCount: '0',
  });

  // Add to reverse index: number -> player IDs
  // Extract all numbers from the grid
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 9; col++) {
      const num = ticket[row][col];
      if (num !== 0) {
        await redis.sadd(`game:${gameId}:number:${num}`, playerId);
      }
    }
  }

  // Set expiration (2 hours after game ends)
  await redis.expire(key, 7200);
}

/**
 * Marks a number for players who have it
 */
export async function markNumber(
  gameId: string,
  calledNumber: number
): Promise<string[]> {
  // Get all players who have this number
  const playerIds = await redis.smembers(`game:${gameId}:number:${calledNumber}`);

  // Mark the number for each player
  for (const playerId of playerIds) {
    const key = `game:${gameId}:player:${playerId}:ticket`;

    const markedNumbersStr = await redis.hget(key, 'markedNumbers');
    const markedNumbers: number[] = markedNumbersStr
      ? JSON.parse(markedNumbersStr)
      : [];

    // Use Set for O(1) duplicate check
    if (!new Set(markedNumbers).has(calledNumber)) {
      markedNumbers.push(calledNumber);

      await redis.hmset(key, {
        markedNumbers: JSON.stringify(markedNumbers),
        markedCount: markedNumbers.length.toString(),
      });
    }
  }

  return playerIds;
}

/**
 * Checks for winners after a number is called
 */
export async function checkForWinners(
  gameId: string,
  calledNumber: number,
  alreadyWonCategories: Set<WinCategory>
): Promise<WinResult[]> {
  const winners: WinResult[] = [];

  // Get players who have the called number (incremental check)
  const playerIds = await redis.smembers(`game:${gameId}:number:${calledNumber}`);

  for (const playerId of playerIds) {
    const key = `game:${gameId}:player:${playerId}:ticket`;

    const playerData = await redis.hgetall(key);
    if (!playerData || !playerData.ticket) continue;

    const ticket: number[][] = JSON.parse(playerData.ticket);  // 3x9 grid
    const markedNumbers: number[] = JSON.parse(playerData.markedNumbers || '[]');
    const markedSet = new Set(markedNumbers);

    // Check Early 5 (only if not already won by someone)
    if (!alreadyWonCategories.has('EARLY_5') && markedSet.size === 5) {
      winners.push({
        playerId,
        userId: playerData.userId,
        category: 'EARLY_5',
      });
    }

    // Check line wins (only if not already won for that specific line)
    const lines = getTicketLines(ticket);

    if (!alreadyWonCategories.has('TOP_LINE') && isLineComplete(lines.top, markedSet)) {
      winners.push({
        playerId,
        userId: playerData.userId,
        category: 'TOP_LINE',
      });
    }

    if (
      !alreadyWonCategories.has('MIDDLE_LINE') &&
      isLineComplete(lines.middle, markedSet)
    ) {
      winners.push({
        playerId,
        userId: playerData.userId,
        category: 'MIDDLE_LINE',
      });
    }

    if (
      !alreadyWonCategories.has('BOTTOM_LINE') &&
      isLineComplete(lines.bottom, markedSet)
    ) {
      winners.push({
        playerId,
        userId: playerData.userId,
        category: 'BOTTOM_LINE',
      });
    }

    // Check Full House (only if not already won)
    if (!alreadyWonCategories.has('FULL_HOUSE') && markedSet.size === 15) {
      winners.push({
        playerId,
        userId: playerData.userId,
        category: 'FULL_HOUSE',
      });
    }
  }

  return winners;
}

/**
 * Gets the lines of a ticket (top, middle, bottom)
 * Extracts numbers from each row of the 3x9 grid
 */
function getTicketLines(ticket: number[][]): {
  top: number[];
  middle: number[];
  bottom: number[];
} {
  // Extract non-zero numbers from each row
  const top = ticket[0].filter((num) => num !== 0);
  const middle = ticket[1].filter((num) => num !== 0);
  const bottom = ticket[2].filter((num) => num !== 0);

  return { top, middle, bottom };
}

/**
 * Checks if all numbers in a line are marked
 */
function isLineComplete(line: number[], markedNumbers: Set<number>): boolean {
  return line.every((num) => markedNumbers.has(num));
}

/**
 * Clears ticket state for a game from Redis using SCAN (non-blocking)
 */
export async function clearGameTickets(gameId: string): Promise<void> {
  const pattern = `game:${gameId}:*`;
  const keys: string[] = [];
  let cursor = '0';

  // Use SCAN to avoid blocking Redis
  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');

  // Delete keys in batches of 100 to avoid blocking
  if (keys.length > 0) {
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      await redis.del(...batch);
    }
  }
}

/**
 * Gets player ticket state from Redis
 */
export async function getPlayerTicketState(
  gameId: string,
  playerId: string
): Promise<PlayerTicketState | null> {
  const key = `game:${gameId}:player:${playerId}:ticket`;
  const playerData = await redis.hgetall(key);

  if (!playerData || !playerData.ticket) {
    return null;
  }

  const ticket: number[][] = JSON.parse(playerData.ticket);  // 3x9 grid
  const markedNumbers: number[] = JSON.parse(playerData.markedNumbers || '[]');

  return {
    playerId,
    userId: playerData.userId,
    ticket,
    markedNumbers: new Set(markedNumbers),
    markedCount: parseInt(playerData.markedCount || '0', 10),
  };
}
