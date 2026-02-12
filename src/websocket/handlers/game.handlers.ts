import type { Socket } from 'socket.io';
import { z } from 'zod';
import { prisma, GameStatus } from '../../models/index.js';
import { redis } from '../../database/redis.js';
import { logger } from '../../utils/logger.js';
import { enhancedLogger, PerformanceTracker } from '../../utils/enhanced-logger.js';
import { generateTicket, getTicketNumbers } from '../../services/ticket.service.js';
import * as gameService from '../../services/game.service.js';
import * as winDetection from '../../services/win-detection.service.js';
import * as prizeService from '../../services/prize.service.js';
import { getIO } from '../io.js';

// In-memory cache for game metadata (avoid DB queries)
interface GameMetadata {
  createdBy: string;
  status: GameStatus;
}
const gameMetadataCache = new Map<string, GameMetadata>();

/**
 * Clear game metadata from cache (call when game status changes to COMPLETED)
 */
export function clearGameMetadataCache(gameId: string): void {
  gameMetadataCache.delete(gameId);
  logger.info({ gameId }, 'Game metadata cache cleared');
}

// Validation schemas
const joinGameSchema = z.object({
  gameId: z.string().uuid('Invalid UUID'),
  userName: z.string().optional(),
});

const lobbyJoinSchema = z.object({
  gameId: z.string().uuid('Invalid UUID'),
  userName: z.string().min(1, 'Username is required'),
});

const lobbyLeaveSchema = z.object({
  gameId: z.string().uuid('Invalid UUID'),
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
 * Handle lobby join - player joins waiting lobby before game starts
 */
export async function handleLobbyJoin(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId, userName } = lobbyJoinSchema.parse(payload);
    const userId = socket.data.userId as string;

    logger.info({ gameId, userId, userName }, 'Player joining waiting lobby');

    // Check if game exists and is in LOBBY status
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    if (game.status !== GameStatus.LOBBY) {
      socket.emit('error', {
        code: 'GAME_ALREADY_STARTED',
        message: 'Cannot join lobby - game has already started',
      });
      return;
    }

    // VIP access control: Check if user is VIP, game organizer, or has ORGANIZER role
    // First check if user is the game creator or has ORGANIZER role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isOrganizer = user?.role === 'ORGANIZER' || game.createdBy === userId;

    if (!isOrganizer) {
      // For regular players, check VIP status
      const { isUserVIP } = await import('../../api/vip-cohort/vip-cohort.controller.js');
      const isVIP = await isUserVIP(userId);

      if (!isVIP) {
        socket.emit('error', {
          code: 'VIP_ONLY',
          message: 'यह गेम केवल STAGE-VIP सदस्यों के लिए है, शामिल होने के लिए STAGE के VIP सदस्य बनें।',
        });
        enhancedLogger.warn(
          { gameId, userId },
          'Non-VIP user attempted to join game lobby'
        );
        return;
      }
    }

    // Add or update player in waiting lobby
    const lobbyPlayer = await prisma.gameLobbyPlayer.upsert({
      where: {
        gameId_userId: {
          gameId,
          userId,
        },
      },
      create: {
        gameId,
        userId,
        userName,
      },
      update: {
        userName, // Update name if rejoining
        joinedAt: new Date(), // Update join time
      },
    });

    // Join socket room for lobby updates
    socket.join(`lobby:${gameId}`);

    // Get all players in lobby
    const allLobbyPlayers = await prisma.gameLobbyPlayer.findMany({
      where: { gameId },
      select: { id: true, userId: true, userName: true, joinedAt: true },
      orderBy: { joinedAt: 'asc' },
    });

    // Confirm join to player
    socket.emit('lobby:joined', {
      gameId,
      playerCount: allLobbyPlayers.length,
      players: allLobbyPlayers.map(p => ({
        userId: p.userId,
        userName: p.userName,
      })),
    });

    // Broadcast to all players in lobby
    const io = getIO();
    io.in(`lobby:${gameId}`).emit('lobby:playerJoined', {
      gameId,
      userId: lobbyPlayer.userId,
      userName: lobbyPlayer.userName,
      playerCount: allLobbyPlayers.length,
      players: allLobbyPlayers.map(p => ({
        userId: p.userId,
        userName: p.userName,
      })),
    });

    // Also notify organizer if they're connected
    const organizerSocketId = await redis.get(`user:${game.createdBy}:socket`);
    if (organizerSocketId) {
      io.to(organizerSocketId).emit('lobby:playerJoined', {
        gameId,
        userId: lobbyPlayer.userId,
        userName: lobbyPlayer.userName,
        playerCount: allLobbyPlayers.length,
        players: allLobbyPlayers.map(p => ({
          userId: p.userId,
          userName: p.userName,
        })),
      });
    }

    logger.info({
      gameId,
      userId,
      userName,
      playerCount: allLobbyPlayers.length,
    }, 'Player joined waiting lobby');
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'lobby:join handler error');
    socket.emit('error', {
      code: 'LOBBY_JOIN_FAILED',
      message: 'Failed to join waiting lobby',
    });
  }
}

/**
 * Handle lobby leave - player leaves waiting lobby
 */
export async function handleLobbyLeave(socket: Socket, payload: unknown): Promise<void> {
  try {
    const { gameId } = lobbyLeaveSchema.parse(payload);
    const userId = socket.data.userId as string;

    logger.info({ gameId, userId }, 'Player leaving waiting lobby');

    // Check if game exists
    const game = await prisma.game.findUnique({
      where: { id: gameId },
    });

    if (!game) {
      socket.emit('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' });
      return;
    }

    // Remove player from lobby
    await prisma.gameLobbyPlayer.delete({
      where: {
        gameId_userId: {
          gameId,
          userId,
        },
      },
    }).catch(() => {
      // Player might not be in lobby, ignore error
    });

    // Leave socket room
    socket.leave(`lobby:${gameId}`);

    // Get remaining players
    const remainingPlayers = await prisma.gameLobbyPlayer.findMany({
      where: { gameId },
      select: { userId: true, userName: true },
      orderBy: { joinedAt: 'asc' },
    });

    // Confirm leave to player
    socket.emit('lobby:left', { gameId });

    // Broadcast to remaining players
    const io = getIO();
    io.in(`lobby:${gameId}`).emit('lobby:playerLeft', {
      gameId,
      userId,
      playerCount: remainingPlayers.length,
      players: remainingPlayers.map(p => ({
        userId: p.userId,
        userName: p.userName,
      })),
    });

    // Also notify organizer
    const organizerSocketId = await redis.get(`user:${game.createdBy}:socket`);
    if (organizerSocketId) {
      io.to(organizerSocketId).emit('lobby:playerLeft', {
        gameId,
        userId,
        playerCount: remainingPlayers.length,
        players: remainingPlayers.map(p => ({
          userId: p.userId,
          userName: p.userName,
        })),
      });
    }

    logger.info({
      gameId,
      userId,
      playerCount: remainingPlayers.length,
    }, 'Player left waiting lobby');
  } catch (error) {
    logger.error({ error, socketId: socket.id }, 'lobby:leave handler error');
    socket.emit('error', {
      code: 'LOBBY_LEAVE_FAILED',
      message: 'Failed to leave waiting lobby',
    });
  }
}

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

    // VIP access control: Check if user is VIP, game organizer, or has ORGANIZER role
    // First check if user is the game creator or has ORGANIZER role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isOrganizer = user?.role === 'ORGANIZER' || game.createdBy === userId;

    if (!isOrganizer) {
      // For regular players, check VIP status
      const { isUserVIP } = await import('../../api/vip-cohort/vip-cohort.controller.js');
      const isVIP = await isUserVIP(userId);

      if (!isVIP) {
        socket.emit('error', {
          code: 'VIP_ONLY',
          message: 'यह गेम केवल STAGE-VIP सदस्यों के लिए है, शामिल होने के लिए STAGE के VIP सदस्य बनें।',
        });
        enhancedLogger.warn(
          { gameId, userId },
          'Non-VIP user attempted to join game'
        );
        return;
      }
    }

    // Allow game creator (organizer) to join as observer without player record
    // NOTE: Organizer does NOT join the game room to avoid Redis adapter race conditions
    // They will receive broadcasts via direct socket.emit() in event handlers
    if (game.createdBy === userId) {

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

    logger.info({
      gameId,
      userId,
      gameStatus: game.status,
      playerRecordExists: !!existingPlayer,
      socketId: socket.id,
    }, 'Player attempting to join game');

    // If game is not in LOBBY, only allow if player already joined (rejoining)
    if (game.status !== GameStatus.LOBBY && !existingPlayer) {
      logger.warn({
        gameId,
        userId,
        gameStatus: game.status,
        socketId: socket.id,
      }, 'Player rejected - game already started and no player record found');

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

      // Get this player's wins for immediate feedback
      const playerWins = winnersData
        .filter(w => w.playerId === existingPlayer.id)
        .map(w => w.category);

      socket.emit('game:joined', {
        gameId,
        playerId: existingPlayer.id,
        ticket: existingPlayer.ticket,
        wins: playerWins, // Include player's wins for immediate sync
      });

      // Fetch markedNumbers from Redis for the rejoining player
      const ticketKey = `game:${gameId}:player:${existingPlayer.id}:ticket`;
      const markedNumbersStr = await redis.hget(ticketKey, 'markedNumbers');
      const markedNumbers = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];

      // Optimized state sync - send only essential data to prevent overload on low-end devices
      // Instead of full player list (173 objects), send only count
      const stateSyncData = {
        calledNumbers: game.calledNumbers || [],
        currentNumber: game.currentNumber,
        players: [], // Empty array - frontend doesn't need all player details for rejoining
        playerCount: allPlayers.length, // Just send count for display
        winners: winners,
        markedNumbers: markedNumbers, // Include player's marked numbers
      };

      console.log('[StateSync] Sending optimized state to rejoining player:', {
        gameId,
        playerId: existingPlayer.id,
        calledNumbersCount: stateSyncData.calledNumbers.length,
        playerCount: allPlayers.length,
        winnersCount: winners.length,
        markedNumbersCount: markedNumbers.length,
        payloadSizeReduction: `${allPlayers.length} player objects removed`,
      });

      socket.emit('game:stateSync', stateSyncData);

      enhancedLogger.playerJoin(
        { gameId, userId, playerId: existingPlayer.id, isRejoin: true },
        'Player rejoined game'
      );
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
          userName = user.name || user.email || userName;
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

          // Optimized state sync - send only essential data
          socket.emit('game:stateSync', {
            calledNumbers: game.calledNumbers || [],
            currentNumber: game.currentNumber,
            players: [], // Empty array - not needed for rejoining player
            playerCount: allPlayers.length, // Just send count
            winners: winners,
            markedNumbers: markedNumbers, // Include player's marked numbers
          });

          enhancedLogger.playerJoin(
            { gameId, userId, playerId: existingPlayer.id, isRejoin: true, raceCondition: true },
            'Player rejoined after race condition'
          );
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
    const broadcastStart = Date.now();
    socket.to(`game:${gameId}`).emit('game:playerJoined', {
      playerId: player.id,
      userName: player.userName,
    });
    const broadcastDuration = Date.now() - broadcastStart;

    enhancedLogger.playerJoin(
      { gameId, userId, playerId: player.id, userName: player.userName },
      'Player joined game'
    );

    if (broadcastDuration > 0) {
      enhancedLogger.broadcastTiming('game:playerJoined', broadcastDuration, 1, { gameId });
    }
  } catch (error) {
    enhancedLogger.error('GAME_JOIN', error, { gameId: (payload as any)?.gameId, userId: socket.data.userId }, 'game:join handler error');
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

    enhancedLogger.playerLeave(
      { gameId, userId: socket.data.userId },
      'Player left game'
    );
  } catch (error) {
    enhancedLogger.error('GAME_LEAVE', error, { gameId: (payload as any)?.gameId, userId: socket.data.userId }, 'game:leave handler error');
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

    // Get all players from waiting lobby
    const lobbyPlayers = await prisma.gameLobbyPlayer.findMany({
      where: { gameId },
      select: { userId: true, userName: true },
    });

    if (lobbyPlayers.length === 0) {
      socket.emit('error', {
        code: 'NO_PLAYERS',
        message: 'Cannot start game with no players in waiting lobby',
      });
      return;
    }

    // Generate tickets for all lobby players and create Player records
    // Use a transaction to ensure all Player records are created atomically
    // This prevents race condition where players try to join before their record exists
    const createdPlayers = await prisma.$transaction(async (tx) => {
      const players = await Promise.all(
        lobbyPlayers.map(async (lobbyPlayer) => {
          const ticket = generateTicket();
          return tx.player.create({
            data: {
              gameId,
              userId: lobbyPlayer.userId,
              userName: lobbyPlayer.userName,
              ticket,
            },
          });
        })
      );

      // Clear lobby players within the same transaction
      await tx.gameLobbyPlayer.deleteMany({
        where: { gameId },
      });

      return players;
    });

    logger.info({
      gameId,
      playerCount: createdPlayers.length,
      userIds: createdPlayers.map(p => p.userId),
    }, 'All Player records created successfully in transaction');

    // Initialize game state in Redis
    await gameService.initializeGameState(gameId);

    // Update status
    await gameService.updateGameStatus(gameId, GameStatus.ACTIVE);

    // Populate cache for fast number calling
    gameMetadataCache.set(gameId, {
      createdBy: game.createdBy,
      status: GameStatus.ACTIVE,
    });

    // Broadcast to all players in lobby room
    const io = getIO();
    io.in(`lobby:${gameId}`).emit('game:starting', { gameId });
    // Also broadcast to game room (in case anyone is already there)
    io.in(`game:${gameId}`).emit('game:starting', { gameId });
    // Direct emit to organizer
    socket.emit('game:starting', { gameId });

    // Enhanced logging for organizer actions
    logger.info({
      event: 'ORGANIZER_ACTION',
      action: 'GAME_STARTED',
      gameId,
      organizerId: userId,
      playerCount: createdPlayers.length,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
      scheduledTime: game.scheduledTime,
    }, `Game started with ${createdPlayers.length} players from waiting lobby`);
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
export async function handleCallNumber(
  socket: Socket,
  payload: unknown,
  callback?: (response: { success: boolean; error?: string }) => void
): Promise<void> {
  const startTime = Date.now();

  try {
    const { gameId, number } = callNumberSchema.parse(payload);
    const userId = socket.data.userId as string;

    // Enhanced logging for organizer actions (easier CloudWatch filtering)
    logger.info({
      event: 'ORGANIZER_ACTION',
      action: 'CALL_NUMBER_START',
      gameId,
      organizerId: userId,
      number,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    }, 'Organizer calling number');

    // Check cache first, only query DB if not cached
    let gameMetadata = gameMetadataCache.get(gameId);

    if (!gameMetadata) {
      // Cache miss - query database
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        select: { createdBy: true, status: true },
      });

      if (!game) {
        const errorMsg = 'Game not found';
        socket.emit('error', {
          code: 'GAME_NOT_FOUND',
          message: errorMsg,
        });
        if (callback) {
          callback({ success: false, error: errorMsg });
        }
        return;
      }

      gameMetadata = {
        createdBy: game.createdBy,
        status: game.status,
      };
      gameMetadataCache.set(gameId, gameMetadata);
    }

    // Verify user is game creator (from cache)
    if (gameMetadata.createdBy !== userId) {
      const errorMsg = 'Only game creator can call numbers';
      socket.emit('error', {
        code: 'FORBIDDEN',
        message: errorMsg,
      });
      if (callback) {
        callback({ success: false, error: errorMsg });
      }
      return;
    }

    if (gameMetadata.status !== GameStatus.ACTIVE) {
      const errorMsg = 'Game is not active';
      socket.emit('error', {
        code: 'GAME_NOT_ACTIVE',
        message: errorMsg,
      });
      if (callback) {
        callback({ success: false, error: errorMsg });
      }
      return;
    }

    // Check duplicate in Redis only (faster than PostgreSQL)
    const key = `game:${gameId}:state`;
    const calledNumbersStr = await redis.hget(key, 'calledNumbers');

    if (!calledNumbersStr) {
      const errorMsg = 'Game state not found';
      socket.emit('error', {
        code: 'GAME_STATE_NOT_FOUND',
        message: errorMsg,
      });
      if (callback) {
        callback({ success: false, error: errorMsg });
      }
      return;
    }

    const calledNumbers: number[] = JSON.parse(calledNumbersStr);

    // Use Set for O(1) duplicate check instead of Array.includes() O(n)
    const calledNumbersSet = new Set(calledNumbers);

    if (calledNumbersSet.has(number)) {
      const errorMsg = `Number ${number} has already been called`;
      socket.emit('error', {
        code: 'NUMBER_ALREADY_CALLED',
        message: errorMsg,
      });
      if (callback) {
        callback({ success: false, error: errorMsg });
      }
      return;
    }

    // Update Redis (fast, synchronous)
    calledNumbers.push(number);
    await redis.hmset(key, {
      calledNumbers: JSON.stringify(calledNumbers),
      currentNumber: number.toString(),
    });

    // Send acknowledgment IMMEDIATELY (don't wait for PostgreSQL)
    if (callback) {
      callback({ success: true });
    }

    // Broadcast number to all players in room
    const io = getIO();
    io.in(`game:${gameId}`).emit('game:numberCalled', { number });
    // Direct emit to organizer (not in room to avoid Redis adapter race)
    socket.emit('game:numberCalled', { number });

    const duration = Date.now() - startTime;

    // Enhanced logging with detailed metrics for monitoring
    logger.info({
      event: 'ORGANIZER_ACTION',
      action: 'CALL_NUMBER_SUCCESS',
      gameId,
      organizerId: userId,
      number,
      totalNumbersCalled: calledNumbers.length,
      duration_ms: duration,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    }, `Number ${number} called successfully (${duration}ms)`);

    // Update PostgreSQL ASYNCHRONOUSLY (don't block)
    prisma.game.update({
      where: { id: gameId },
      data: {
        calledNumbers,
        currentNumber: number,
      },
    }).catch(error => {
      logger.error({ error, gameId, number }, 'Failed to update PostgreSQL (async)');
      // TODO: Add retry logic or queue
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    const payload = typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);

    // Enhanced error logging for debugging
    logger.error({
      event: 'ORGANIZER_ACTION',
      action: 'CALL_NUMBER_ERROR',
      gameId: (error as any)?.gameId || 'unknown',
      organizerId: socket.data.userId,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      duration_ms: duration,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    }, 'game:callNumber handler error');

    const errorMsg = error instanceof Error ? error.message : 'Failed to call number';

    socket.emit('error', {
      code: 'CALL_NUMBER_FAILED',
      message: errorMsg,
    });

    // Send error acknowledgment
    if (callback) {
      callback({ success: false, error: errorMsg });
    }
  }
}

/**
 * Handle win claim (player claims a winning pattern)
 */
export async function handleClaimWin(socket: Socket, payload: unknown): Promise<void> {
  const tracker = new PerformanceTracker('claimWin', { gameId: (payload as any)?.gameId, category: (payload as any)?.category });

  try {
    const { gameId, category } = claimWinSchema.parse(payload);
    const userId = socket.data.userId as string;

    // Log win claim attempt
    enhancedLogger.playerWinClaim(
      { gameId, userId, category, action: 'CLAIM_ATTEMPT' },
      `Player attempting to claim ${category}`
    );

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

      // Broadcast to winner with acknowledgment for reliable delivery
      const ackTimeout = setTimeout(() => {
        enhancedLogger.warn(
          { gameId, userId, playerId: player.id, category },
          'game:winClaimed acknowledgment timeout - event may not have reached frontend'
        );
      }, 5000);

      socket.emit('game:winClaimed', {
        category,
        success: true,
        message: `Congratulations! You won ${category.split('_').join(' ')}!`,
      }, () => {
        // Event successfully acknowledged by frontend
        clearTimeout(ackTimeout);
        enhancedLogger.info(
          { gameId, userId, playerId: player.id, category },
          'game:winClaimed event acknowledged by winner'
        );
      });

      // Broadcast to all players and organizer in the game room (except the winner)
      const broadcastStart = Date.now();
      socket.to(`game:${gameId}`).emit('game:winner', {
        playerId: player.id,
        userId: userId,  // Mobile app userId for analytics tracking
        userName: player.userName || user?.name,  // Use entered name first, fallback to User table
        category,
      });
      const broadcastDuration = Date.now() - broadcastStart;

      const duration = tracker.end({ success: true });
      enhancedLogger.playerWinClaim(
        { gameId, userId, playerId: player.id, category, duration_ms: duration, prizeValue },
        `Win claimed successfully: ${category}`
      );

      if (broadcastDuration > 0) {
        enhancedLogger.broadcastTiming('game:winner', broadcastDuration, 1, { gameId, category });
      }

      // Check if game complete (all categories won)
      const updatedState = await gameService.getGameState(gameId);
      if (updatedState?.wonCategories.has('FULL_HOUSE')) {
        await gameService.updateGameStatus(gameId, GameStatus.COMPLETED);
        // Broadcast to all players in room
        const io = getIO();
        io.in(`game:${gameId}`).emit('game:completed', { gameId });
        // Note: organizer not in room, will see completion via stateSync
        logger.info({ gameId }, 'Game completed');
      }
    } finally {
      await redis.del(lockKey);
    }
  } catch (error) {
    const duration = tracker.getDuration();
    enhancedLogger.error(
      'WIN_CLAIM',
      error,
      {
        gameId: (payload as any)?.gameId,
        category: (payload as any)?.category,
        userId: socket.data.userId,
        duration_ms: duration
      },
      'game:claimWin handler error'
    );
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

    // Verify number was called (O(1) Set lookup)
    const calledNumbers = game.calledNumbers as number[];
    if (!new Set(calledNumbers).has(number)) {
      socket.emit('error', { code: 'NUMBER_NOT_CALLED', message: 'Number not called yet' });
      return;
    }

    // Update marked numbers in Redis
    const key = `game:${gameId}:player:${playerId}:ticket`;
    const markedNumbersStr = await redis.hget(key, 'markedNumbers');
    const markedNumbers: number[] = markedNumbersStr ? JSON.parse(markedNumbersStr) : [];

    // Check if already marked (O(1) Set lookup)
    if (!new Set(markedNumbers).has(number)) {
      markedNumbers.push(number);
      await redis.hmset(key, {
        markedNumbers: JSON.stringify(markedNumbers),
        markedCount: markedNumbers.length.toString(),
      });

      enhancedLogger.playerMarkNumber(
        { gameId, playerId, userId, number, totalMarked: markedNumbers.length },
        `Player marked number ${number} (total: ${markedNumbers.length})`
      );
    }
  } catch (error) {
    enhancedLogger.error('MARK_NUMBER', error, { gameId: (payload as any)?.gameId, playerId: (payload as any)?.playerId, userId: socket.data.userId }, 'game:markNumber handler error');
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
