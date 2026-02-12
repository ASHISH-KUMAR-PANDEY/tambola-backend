import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as gamesController from './games.controller.js';
import { cleanupOldGames } from './cleanup-games.js';

export async function gamesRoutes(fastify: FastifyInstance): Promise<void> {
  // VIP-only routes (require auth and VIP status)
  fastify.get('/', { onRequest: authMiddleware }, gamesController.listGames);

  // Public routes (no auth required)
  fastify.get('/my-active', gamesController.getMyActiveGames);
  fastify.get('/:gameId', gamesController.getGame);
  fastify.get('/:gameId/players/:playerId', gamesController.getPlayerDetails);

  // Protected routes (require auth - organizer only)
  fastify.post('/', { onRequest: authMiddleware }, gamesController.createGame);
  fastify.patch('/:gameId/status', { onRequest: authMiddleware }, gamesController.updateGameStatus);
  fastify.delete('/:gameId', { onRequest: authMiddleware }, gamesController.deleteGame);
  fastify.post('/cleanup', { onRequest: authMiddleware }, cleanupOldGames);
}
