import type { Socket } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Game, Player, Winner, User, GameStatus } from '../../models/index.js';
import { redis } from '../../database/redis.js';
import { logger } from '../../utils/logger.js';
import { generateTicket, getTicketNumbers } from '../../services/ticket.service.js';
import * as gameService from '../../services/game.service.js';
import * as winDetection from '../../services/win-detection.service.js';
import * as prizeService from '../../services/prize.service.js';

// Validation schemas
const joinGameSchema = z.object({
  gameId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId'),
});

const callNumberSchema = z.object({
  gameId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId'),
  number: z.number().int().min(1).max(90),
});

const claimWinSchema = z.object({
  gameId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId'),
  category: z.enum(['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE']),
});

const markNumberSchema = z.object({
  gameId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId'),
  playerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid MongoDB ObjectId'),
  number: z.number().int().min(1).max(90),
});

/**
 * Handle player joining a game
 */
export async function handleGameJoin(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId } = joinGameSchema.parse(payload);
    const userId = socket.data.userId as string;

    // Check if game exists
    const game = await Game.findById(gameId);

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    // Allow game creator (organizer) to join as observer without player record
    if (game.createdBy === userId) {
      socket.join(`game:${gameId}`);

      // Get all players and winners
      const allPlayers = await Player.find({ gameId }).select('_id userName').lean();
      const winners = await Winner.find({ gameId }).select('playerId category').lean();

      // Get user details for winners
      const winnersWithDetails = await Promise.all(
        winners.map(async (w) => {
          const player = await Player.findById(w.playerId).lean();
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
          playerId: p._id.toString(),
          userName: p.userName,
        })),
        winners: winnersWithDetails,
      });

      logger.info({ gameId, userId, role: 'organizer' }, 'Organizer joined game as observer');
      return;
    }

    // Check if player already joined
    const existingPlayer = await Player.findOne({ gameId, userId });

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
      const allPlayers = await Player.find({ gameId }).select('_id userName').lean();

      // Get all winners
      const winnersData = await Winner.find({ gameId }).select('playerId category').lean();

      // Map winners with userName from players
      const winners = winnersData.map((w) => {
        const player = allPlayers.find((p) => p._id.toString() === w.playerId);
        return {
          playerId: w.playerId,
          category: w.category,
          userName: player?.userName,
        };
      });

      socket.emit('game:joined', {
        gameId,
        playerId: existingPlayer._id.toString(),
        ticket: existingPlayer.ticket,
      });

      // Fetch markedNumbers from Redis for the rejoining player
      const ticketKey = `game:${gameId}:player:${existingPlayer._id.toString()}:ticket`;
      const markedNumbersStr = await redis.hget(ticketKey, 'markedNumbers');
      const markedNumbers = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];

      // Send current game state for rejoining player
      const stateSyncData = {
        calledNumbers: game.calledNumbers || [],
        currentNumber: game.currentNumber,
        players: allPlayers.map((p) => ({
          playerId: p._id.toString(),
          userName: p.userName,
        })),
        winners: winners,
        markedNumbers: markedNumbers, // Include player's marked numbers
      };

      console.log('[StateSync] Sending to rejoining player:', {
        gameId,
        playerId: existingPlayer._id.toString(),
        winnersCount: winners.length,
        winners: winners,
        markedNumbersCount: markedNumbers.length,
      });

      socket.emit('game:stateSync', stateSyncData);

      logger.info({ gameId, userId, playerId: existingPlayer._id.toString() }, 'Player rejoined game');
      return;
    }

    // Generate ticket (3x9 grid)
    const ticketGrid = generateTicket();

    // Get userName - try to fetch from User collection, fallback to userId
    let userName = `Player ${userId.slice(-4)}`;
    try {
      // Only query User model if userId is a valid ObjectId (not mobile app user)
      if (mongoose.Types.ObjectId.isValid(userId)) {
        const user = await User.findById(userId).select('name email').lean();
        if (user) {
          userName = user.name || user.email;
        }
      }
    } catch (err) {
      // User might not exist (mobile app users), use default
    }

    let player;
    try {
      // Create player record (store full grid as JSON)
      player = await Player.create({
        gameId,
        userId,
        userName,
        ticket: ticketGrid,  // Store as JSON grid
      });
    } catch (error: any) {
      // Handle race condition: player already joined in another tab
      if (error.code === 11000) {
        // Duplicate key error - player already exists
        const existingPlayer = await Player.findOne({ gameId, userId });

        if (existingPlayer) {
          socket.join(`game:${gameId}`);

          // Get all players and winners for state sync
          const allPlayers = await Player.find({ gameId }).select('_id userName').lean();
          const winnersData = await Winner.find({ gameId }).select('playerId category').lean();

          // Map winners with userName from players
          const winners = winnersData.map((w) => {
            const player = allPlayers.find((p) => p._id.toString() === w.playerId);
            return {
              playerId: w.playerId,
              category: w.category,
              userName: player?.userName,
            };
          });

          socket.emit('game:joined', {
            gameId,
            playerId: existingPlayer._id.toString(),
            ticket: existingPlayer.ticket,
          });

          // Fetch markedNumbers from Redis for the rejoining player
          const ticketKey = `game:${gameId}:player:${existingPlayer._id.toString()}:ticket`;
          const markedNumbersStr = await redis.hget(ticketKey, 'markedNumbers');
          const markedNumbers = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];

          socket.emit('game:stateSync', {
            calledNumbers: game.calledNumbers || [],
            currentNumber: game.currentNumber,
            players: allPlayers.map((p) => ({
              playerId: p._id.toString(),
              userName: p.userName,
            })),
            winners: winners,
            markedNumbers: markedNumbers, // Include player's marked numbers
          });

          logger.info({ gameId, userId, playerId: existingPlayer._id.toString() }, 'Player rejoined after race');
          return;
        }
      }
      throw error;
    }

    // Initialize ticket in Redis
    await winDetection.initializePlayerTicket(
      gameId,
      player._id.toString(),
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
      playerId: player._id.toString(),
      ticket: player.ticket,
    });

    // Broadcast to room that a player joined
    socket.to(`game:${gameId}`).emit('game:playerJoined', {
      playerId: player._id.toString(),
      userName: player.userName,
    });

    logger.info({ gameId, userId, playerId: player._id.toString() }, 'Player joined game');
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
    const game = await Game.findById(gameId);

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
    const playerCount = await Player.countDocuments({ gameId });

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
    const game = await Game.findById(gameId);

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
    if (game.calledNumbers.includes(number)) {
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
    const game = await Game.findById(gameId);

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    if (game.status !== GameStatus.ACTIVE) {
      socket.emit('error', { code: 'GAME_NOT_ACTIVE', message: 'Game is not active' });
      return;
    }

    // Get player
    const player = await Player.findOne({ gameId, userId });

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
    const calledNumbers = game.calledNumbers;

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
      await Winner.create({
        gameId,
        playerId: player._id.toString(),
        category,
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
      // Only query User model if userId is a valid ObjectId (not mobile app user)
      let user = null;
      if (mongoose.Types.ObjectId.isValid(userId)) {
        user = await User.findById(userId);
      }

      // Broadcast to winner
      socket.emit('game:winClaimed', {
        category,
        success: true,
        message: `Congratulations! You won ${category.split('_').join(' ')}!`,
      });

      // Broadcast to all players and organizer in the game room (except the winner)
      socket.to(`game:${gameId}`).emit('game:winner', {
        playerId: player._id.toString(),
        userName: user?.name || player.userName,
        category,
      });

      logger.info({ gameId, userId, playerId: player._id.toString(), category }, 'Win claimed successfully');

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
    const player = await Player.findOne({ _id: playerId, gameId, userId });

    if (!player) {
      socket.emit('error', { code: 'INVALID_PLAYER', message: 'Invalid player or ticket' });
      return;
    }

    // Get game to check if number was called
    const game = await Game.findById(gameId);

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    // Verify number was called
    if (!game.calledNumbers.includes(number)) {
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
