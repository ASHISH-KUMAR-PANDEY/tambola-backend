import type { Socket } from 'socket.io';
import { z } from 'zod';
import { prisma, GameStatus } from '../../models/index.js';
import { redis } from '../../database/redis.js';
import { logger } from '../../utils/logger.js';
import { generateTicket, getTicketNumbers } from '../../services/ticket.service.js';
import * as gameService from '../../services/game.service.js';
import * as winDetection from '../../services/win-detection.service.js';
import * as prizeService from '../../services/prize.service.js';

// Validation schemas
const joinGameSchema = z.object({
  gameId: z.string().uuid('Invalid UUID'),
  userName: z.string().optional(),
});

const callNumberSchema = z.object({
  gameId: z.string().uuid('Invalid UUID'),
  number: z.number().int().min(1).max(90),
});

const claimWinSchema = z.object({
  gameId: z.string().uuid('Invalid UUID'),
  category: z.enum(['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE']),
});

const markNumberSchema = z.object({
  gameId: z.string().uuid('Invalid UUID'),
  playerId: z.string().uuid('Invalid UUID'),
  number: z.number().int().min(1).max(90),
});

/**
 * Handle player joining a game
 */
export async function handleGameJoin(socket: Socket, payload: unknown): Promise<void> {
  try {
    console.log('[handleGameJoin] ===== GAME JOIN REQUEST =====');
    console.log('[handleGameJoin] Raw payload:', JSON.stringify(payload));
    const { gameId, userName: providedUserName } = joinGameSchema.parse(payload);
    const userId = socket.data.userId as string;
    console.log('[handleGameJoin] gameId:', gameId);
    console.log('[handleGameJoin] userId:', userId);
    console.log('[handleGameJoin] providedUserName:', JSON.stringify(providedUserName));
    console.log('[handleGameJoin] providedUserName type:', typeof providedUserName);
    console.log('[handleGameJoin] providedUserName length:', providedUserName?.length);
    console.log('[handleGameJoin] providedUserName truthy?:', !!providedUserName);
    console.log('[handleGameJoin] providedUserName.trim() truthy?:', !!(providedUserName && providedUserName.trim()));

    // Check if game exists
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    // Allow game creator (organizer) to join as observer without player record
    if (game.createdBy === userId) {
      socket.join(`game:${gameId}`);

      // Get all players and winners
      const allPlayers = await prisma.player.findMany({
        where: { gameId },
        select: { id: true, userName: true },
      });
      const winners = await prisma.winner.findMany({
        where: { gameId },
        select: { playerId: true, category: true },
      });

      // Get user details for winners
      const winnersWithDetails = await Promise.all(
        winners.map(async (w) => {
          const player = await prisma.player.findUnique({
            where: { id: w.playerId },
          });
          return {
            playerId: w.playerId,
            category: w.category,
            userName: player?.userName || 'Unknown',
          };
        })
      );

      // Send game:joined without playerId/ticket (organizer is observer)
      socket.emit('game:joined', {
        gameId,
        playerId: null,
        ticket: null,
      });

      // Send current game state
      socket.emit('game:stateSync', {
        calledNumbers: game.calledNumbers || [],
        currentNumber: game.currentNumber,
        players: allPlayers.map((p) => ({
          playerId: p.id,
          userName: p.userName,
        })),
        winners: winnersWithDetails,
      });

      logger.info({ gameId, userId, role: 'organizer' }, 'Organizer joined game as observer');
      return;
    }

    // Check if player already joined
    const existingPlayer = await prisma.player.findUnique({
      where: {
        gameId_userId: {
          gameId,
          userId,
        },
      },
    });

    // If game is not in LOBBY, only allow if player already joined (rejoining)
    if (game.status !== GameStatus.LOBBY && !existingPlayer) {
      socket.emit('error', {
        code: 'GAME_ALREADY_STARTED',
        message: 'Cannot join game that has already started',
      });
      return;
    }

    if (existingPlayer) {
      // Player rejoining - send full game state
      socket.join(`game:${gameId}`);

      // Get all players in the game
      const allPlayers = await prisma.player.findMany({
        where: { gameId },
        select: { id: true, userName: true },
      });

      // Get all winners
      const winnersData = await prisma.winner.findMany({
        where: { gameId },
        select: { playerId: true, category: true },
      });

      // Map winners with userName from players
      const winners = winnersData.map((w) => {
        const player = allPlayers.find((p) => p.id === w.playerId);
        return {
          playerId: w.playerId,
          category: w.category,
          userName: player?.userName,
        };
      });

      socket.emit('game:joined', {
        gameId,
        playerId: existingPlayer.id,
        ticket: existingPlayer.ticket,
      });

      // Fetch markedNumbers from Redis for the rejoining player
      const ticketKey = `game:${gameId}:player:${existingPlayer.id}:ticket`;
      const markedNumbersStr = await redis.hget(ticketKey, 'markedNumbers');
      const markedNumbers = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];

      // Send current game state for rejoining player
      const stateSyncData = {
        calledNumbers: game.calledNumbers || [],
        currentNumber: game.currentNumber,
        players: allPlayers.map((p) => ({
          playerId: p.id,
          userName: p.userName,
        })),
        winners: winners,
        markedNumbers: markedNumbers, // Include player's marked numbers
      };

      console.log('[StateSync] Sending to rejoining player:', {
        gameId,
        playerId: existingPlayer.id,
        winnersCount: winners.length,
        winners: winners,
        markedNumbersCount: markedNumbers.length,
      });

      socket.emit('game:stateSync', stateSyncData);

      logger.info({ gameId, userId, playerId: existingPlayer.id }, 'Player rejoined game');
      return;
    }

    // Generate ticket (3x9 grid)
    const ticketGrid = generateTicket();

    // Get userName - use provided name, or try User collection, or fallback to userId
    let userName: string;
    console.log('[handleGameJoin] ===== USERNAME RESOLUTION =====');
    if (providedUserName && providedUserName.trim()) {
      // Use provided name if it's a non-empty string
      userName = providedUserName.trim();
      console.log('[handleGameJoin] ✓ Using PROVIDED userName:', userName);
    } else {
      console.log('[handleGameJoin] ✗ No valid provided userName, falling back to database');
      // Fall back to User record or default
      userName = `Player ${userId.slice(-4)}`;
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true },
        });
        console.log('[handleGameJoin] User record found:', !!user);
        if (user) {
          console.log('[handleGameJoin] User.name:', user.name);
          console.log('[handleGameJoin] User.email:', user.email);
          userName = user.name || user.email;
          console.log('[handleGameJoin] ✓ Using database userName:', userName);
        } else {
          console.log('[handleGameJoin] ✓ No user record, using fallback:', userName);
        }
      } catch (err) {
        console.log('[handleGameJoin] Error querying user:', err);
        console.log('[handleGameJoin] ✓ Using fallback userName:', userName);
      }
    }
    console.log('[handleGameJoin] FINAL userName:', userName);

    let player;
    try {
      // Create player record (store full grid as JSON)
      player = await prisma.player.create({
        data: {
          gameId,
          userId,
          userName,
          ticket: ticketGrid,  // Store as JSON grid
        },
      });
    } catch (error: any) {
      // Handle race condition: player already joined in another tab
      if (error.code === 'P2002') {
        // Unique constraint violation - player already exists
        let existingPlayer = await prisma.player.findUnique({
          where: {
            gameId_userId: {
              gameId,
              userId,
            },
          },
        });

        if (existingPlayer) {
          // Update userName if provided (user might have changed their name)
          if (userName && userName !== existingPlayer.userName) {
            existingPlayer = await prisma.player.update({
              where: { id: existingPlayer.id },
              data: { userName },
            });
            console.log('[handleGameJoin] Updated existing player userName to:', userName);
          }

          socket.join(`game:${gameId}`);

          // Get all players and winners for state sync
          const allPlayers = await prisma.player.findMany({
            where: { gameId },
            select: { id: true, userName: true },
          });
          const winnersData = await prisma.winner.findMany({
            where: { gameId },
            select: { playerId: true, category: true },
          });

          // Map winners with userName from players
          const winners = winnersData.map((w) => {
            const player = allPlayers.find((p) => p.id === w.playerId);
            return {
              playerId: w.playerId,
              category: w.category,
              userName: player?.userName,
            };
          });

          socket.emit('game:joined', {
            gameId,
            playerId: existingPlayer.id,
            ticket: existingPlayer.ticket,
          });

          // Fetch markedNumbers from Redis for the rejoining player
          const ticketKey = `game:${gameId}:player:${existingPlayer.id}:ticket`;
          const markedNumbersStr = await redis.hget(ticketKey, 'markedNumbers');
          const markedNumbers = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];

          socket.emit('game:stateSync', {
            calledNumbers: game.calledNumbers || [],
            currentNumber: game.currentNumber,
            players: allPlayers.map((p) => ({
              playerId: p.id,
              userName: p.userName,
            })),
            winners: winners,
            markedNumbers: markedNumbers, // Include player's marked numbers
          });

          logger.info({ gameId, userId, playerId: existingPlayer.id }, 'Player rejoined after race');
          return;
        }
      }
      throw error;
    }

    // Initialize ticket in Redis
    await winDetection.initializePlayerTicket(
      gameId,
      player.id,
      userId,
      ticketGrid  // Pass grid structure
    );

    // Join socket room
    socket.join(`game:${gameId}`);

    // Increment player count in Redis
    await gameService.incrementPlayerCount(gameId);

    // Send ticket to player
    socket.emit('game:joined', {
      gameId,
      playerId: player.id,
      ticket: player.ticket,
    });

    // Broadcast to room that a player joined
    socket.to(`game:${gameId}`).emit('game:playerJoined', {
      playerId: player.id,
      userName: player.userName,
    });

    logger.info({ gameId, userId, playerId: player.id }, 'Player joined game');
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'game:join handler error');
    socket.emit('error', {
      code: 'JOIN_FAILED',
      message: error instanceof Error ? error.message : 'Failed to join game',
    });
  }
}

/**
 * Handle player leaving a game
 */
export async function handleGameLeave(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId } = joinGameSchema.parse(payload);

    socket.leave(`game:${gameId}`);

    socket.emit('game:left', { gameId });

    logger.info({ gameId, userId: socket.data.userId }, 'Player left game');
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'game:leave handler error');
    socket.emit('error', {
      code: 'LEAVE_FAILED',
      message: 'Failed to leave game',
    });
  }
}

/**
 * Handle game start (organizer only)
 */
export async function handleGameStart(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId } = joinGameSchema.parse(payload);
    const userId = socket.data.userId as string;

    // Verify user is game creator
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    if (game.createdBy !== userId) {
      socket.emit('error', {
        code: 'FORBIDDEN',
        message: 'Only game creator can start the game',
      });
      return;
    }

    if (game.status !== GameStatus.LOBBY) {
      socket.emit('error', {
        code: 'INVALID_STATUS',
        message: 'Game is not in lobby status',
      });
      return;
    }

    // Check minimum players
    const playerCount = await prisma.player.count({
      where: { gameId },
    });

    if (playerCount === 0) {
      socket.emit('error', {
        code: 'NO_PLAYERS',
        message: 'Cannot start game with no players',
      });
      return;
    }

    // Initialize game state in Redis
    await gameService.initializeGameState(gameId);

    // Update status
    await gameService.updateGameStatus(gameId, GameStatus.ACTIVE);

    // Broadcast to all players in the game
    socket.to(`game:${gameId}`).emit('game:started', { gameId });
    socket.emit('game:started', { gameId });

    logger.info({ gameId, userId }, 'Game started');
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'game:start handler error');
    socket.emit('error', {
      code: 'START_FAILED',
      message: 'Failed to start game',
    });
  }
}

/**
 * Handle number call (organizer only)
 */
export async function handleCallNumber(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId, number } = callNumberSchema.parse(payload);
    const userId = socket.data.userId as string;

    // Verify user is game creator
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game || game.createdBy !== userId) {
      socket.emit('error', {
        code: 'FORBIDDEN',
        message: 'Only game creator can call numbers',
      });
      return;
    }

    if (game.status !== GameStatus.ACTIVE) {
      socket.emit('error', {
        code: 'GAME_NOT_ACTIVE',
        message: 'Game is not active',
      });
      return;
    }

    // Check if number already called
    const calledNumbers = game.calledNumbers as number[];
    if (calledNumbers.includes(number)) {
      socket.emit('error', {
        code: 'NUMBER_ALREADY_CALLED',
        message: `Number ${number} has already been called`,
      });
      return;
    }

    // Call the number (add to game state)
    await gameService.callNumber(gameId, number);

    // Broadcast number to all players
    socket.to(`game:${gameId}`).emit('game:numberCalled', { number });
    socket.emit('game:numberCalled', { number });

    logger.info({ gameId, number }, 'Number called');
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'game:callNumber handler error');
    socket.emit('error', {
      code: 'CALL_NUMBER_FAILED',
      message: error instanceof Error ? error.message : 'Failed to call number',
    });
  }
}

/**
 * Handle win claim (player claims a winning pattern)
 */
export async function handleClaimWin(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId, category } = claimWinSchema.parse(payload);
    const userId = socket.data.userId as string;

    // Get game
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    if (game.status !== GameStatus.ACTIVE) {
      socket.emit('error', { code: 'GAME_NOT_ACTIVE', message: 'Game is not active' });
      return;
    }

    // Get player
    const player = await prisma.player.findUnique({
      where: {
        gameId_userId: {
          gameId,
          userId,
        },
      },
    });

    if (!player) {
      socket.emit('error', { code: 'PLAYER_NOT_FOUND', message: 'You are not in this game' });
      return;
    }

    // Check if category already won
    const gameState = await gameService.getGameState(gameId);
    if (gameState?.wonCategories.has(category)) {
      socket.emit('error', {
        code: 'CATEGORY_ALREADY_WON',
        message: `${category} has already been won`,
      });
      return;
    }

    // Validate the claim
    const ticket = player.ticket as number[][];
    const calledNumbers = game.calledNumbers as number[];

    const isValid = validateClaim(ticket, calledNumbers, category);

    if (!isValid) {
      socket.emit('error', {
        code: 'INVALID_CLAIM',
        message: 'Your claim is invalid. Not all numbers are called or marked.',
      });
      return;
    }

    // Use distributed lock to prevent race conditions
    const lockKey = `lock:winner:${gameId}:${category}`;
    const lockValue = `${Date.now()}`;
    const lockAcquired = await redis.set(lockKey, lockValue, 'EX', 5, 'NX');

    if (!lockAcquired) {
      socket.emit('error', {
        code: 'CATEGORY_ALREADY_CLAIMED',
        message: 'Someone else is claiming this category',
      });
      return;
    }

    try {
      // Double-check category not won
      const latestState = await gameService.getGameState(gameId);
      if (latestState?.wonCategories.has(category)) {
        socket.emit('error', {
          code: 'CATEGORY_ALREADY_WON',
          message: `${category} has already been won`,
        });
        return;
      }

      // Record winner
      await prisma.winner.create({
        data: {
          gameId,
          playerId: player.id,
          category,
        },
      });

      // Record won category
      await gameService.recordWinner(gameId, category);

      // Enqueue prize
      const prizeValue = (game.prizes as any)[getCategoryPrizeKey(category)];
      if (prizeValue) {
        await prizeService.enqueuePrize({
          userId,
          gameId,
          category,
          prizeValue,
        });
      }

      // Get user info for broadcast
      let user = null;
      try {
        user = await prisma.user.findUnique({
          where: { id: userId },
        });
      } catch (err) {
        // User might not exist (mobile app users), use default
      }

      // Broadcast to winner
      socket.emit('game:winClaimed', {
        category,
        success: true,
        message: `Congratulations! You won ${category.split('_').join(' ')}!`,
      });

      // Broadcast to all players and organizer in the game room (except the winner)
      socket.to(`game:${gameId}`).emit('game:winner', {
        playerId: player.id,
        userName: user?.name || player.userName,
        category,
      });

      logger.info({ gameId, userId, playerId: player.id, category }, 'Win claimed successfully');

      // Check if game complete (all categories won)
      const updatedState = await gameService.getGameState(gameId);
      if (updatedState?.wonCategories.has('FULL_HOUSE')) {
        await gameService.updateGameStatus(gameId, GameStatus.COMPLETED);
        socket.to(`game:${gameId}`).emit('game:completed', { gameId });
        socket.emit('game:completed', { gameId });
        logger.info({ gameId }, 'Game completed');
      }
    } finally {
      await redis.del(lockKey);
    }
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'game:claimWin handler error');
    socket.emit('error', {
      code: 'CLAIM_FAILED',
      message: error instanceof Error ? error.message : 'Failed to claim win',
    });
  }
}

/**
 * Handle player manually marking a number
 */
export async function handleMarkNumber(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId, playerId, number } = markNumberSchema.parse(payload);
    const userId = socket.data.userId as string;

    // Verify player owns this ticket
    const player = await prisma.player.findFirst({
      where: {
        id: playerId,
        gameId,
        userId,
      },
    });

    if (!player) {
      socket.emit('error', { code: 'INVALID_PLAYER', message: 'Invalid player or ticket' });
      return;
    }

    // Get game to check if number was called
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    // Verify number was called
    const calledNumbers = game.calledNumbers as number[];
    if (!calledNumbers.includes(number)) {
      socket.emit('error', { code: 'NUMBER_NOT_CALLED', message: 'Number not called yet' });
      return;
    }

    // Update marked numbers in Redis
    const key = `game:${gameId}:player:${playerId}:ticket`;
    const markedNumbersStr = await redis.hget(key, 'markedNumbers');
    const markedNumbers: number[] = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];

    if (!markedNumbers.includes(number)) {
      markedNumbers.push(number);
      await redis.hmset(key, {
        markedNumbers: JSON.stringify(markedNumbers),
        markedCount: markedNumbers.length.toString(),
      });

      logger.info({ gameId, playerId, number, total: markedNumbers.length }, 'Player marked number');
    }
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'game:markNumber handler error');
    socket.emit('error', {
      code: 'MARK_FAILED',
      message: error instanceof Error ? error.message : 'Failed to mark number',
    });
  }
}

/**
 * Validate if a claim is valid
 */
function validateClaim(
  ticket: number[][],
  calledNumbers: number[],
  category: string
): boolean {
  const calledSet = new Set(calledNumbers);

  switch (category) {
    case 'EARLY_5': {
      // Check if any 5 numbers from ticket are called
      const ticketNumbers = ticket.flat().filter((n) => n !== 0);
      const markedCount = ticketNumbers.filter((n) => calledSet.has(n)).length;
      return markedCount >= 5;
    }

    case 'TOP_LINE': {
      const lineNumbers = ticket[0].filter((n) => n !== 0);
      return lineNumbers.every((n) => calledSet.has(n));
    }

    case 'MIDDLE_LINE': {
      const lineNumbers = ticket[1].filter((n) => n !== 0);
      return lineNumbers.every((n) => calledSet.has(n));
    }

    case 'BOTTOM_LINE': {
      const lineNumbers = ticket[2].filter((n) => n !== 0);
      return lineNumbers.every((n) => calledSet.has(n));
    }

    case 'FULL_HOUSE': {
      const allNumbers = ticket.flat().filter((n) => n !== 0);
      return allNumbers.every((n) => calledSet.has(n));
    }

    default:
      return false;
  }
}

/**
 * Maps win category to prize key in game.prizes JSON
 */
function getCategoryPrizeKey(category: string): string {
  const mapping: Record<string, string> = {
    EARLY_5: 'early5',
    TOP_LINE: 'topLine',
    MIDDLE_LINE: 'middleLine',
    BOTTOM_LINE: 'bottomLine',
    FULL_HOUSE: 'fullHouse',
  };

  return mapping[category] || 'fullHouse';
}
