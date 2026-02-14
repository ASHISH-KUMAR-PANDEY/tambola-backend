import type { FastifyInstance } from 'fastify';
import { authMiddleware, optionalAuthMiddleware } from '../../middleware/auth.middleware.js';
import * as gamesController from './games.controller.js';
import { cleanupOldGames } from './cleanup-games.js';
import { deleteAllGames } from './delete-all-games.js';

export async function gamesRoutes(fastify: FastifyInstance): Promise<void> {
  // VIP-only routes (optional auth - checked in controller)
  fastify.get('/', { onRequest: optionalAuthMiddleware }, gamesController.listGames);

  // Public routes (no auth required)
  fastify.get('/my-active', gamesController.getMyActiveGames);
  fastify.get('/:gameId', gamesController.getGame);
  fastify.get('/:gameId/players/:playerId', gamesController.getPlayerDetails);

  // Protected routes (require auth - organizer only)
  fastify.post('/', { onRequest: authMiddleware }, gamesController.createGame);
  fastify.patch('/:gameId/status', { onRequest: authMiddleware }, gamesController.updateGameStatus);
  fastify.delete('/:gameId', { onRequest: authMiddleware }, gamesController.deleteGame);
  fastify.post('/cleanup', { onRequest: authMiddleware }, cleanupOldGames);
  fastify.post('/delete-all', { onRequest: authMiddleware }, deleteAllGames);
}
