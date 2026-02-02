import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as gamesController from './games.controller.js';

export async function gamesRoutes(fastify: FastifyInstance): Promise<void> {
  // Public routes (no auth required)
  fastify.get('/', gamesController.listGames);
  fastify.get('/my-active', gamesController.getMyActiveGames);
  fastify.get('/:gameId', gamesController.getGame);

  // Protected routes (require auth - organizer only)
  fastify.post('/', { onRequest: authMiddleware }, gamesController.createGame);
  fastify.patch('/:gameId/status', { onRequest: authMiddleware }, gamesController.updateGameStatus);
  fastify.delete('/:gameId', { onRequest: authMiddleware }, gamesController.deleteGame);
}
