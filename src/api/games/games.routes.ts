import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as gamesController from './games.controller.js';

export async function gamesRoutes(fastify: FastifyInstance): Promise<void> {
  // All game routes require authentication
  fastify.addHook('onRequest', authMiddleware);

  fastify.post('/', gamesController.createGame);
  fastify.get('/', gamesController.listGames);
  fastify.get('/:gameId', gamesController.getGame);
  fastify.patch('/:gameId/status', gamesController.updateGameStatus);
  fastify.delete('/:gameId', gamesController.deleteGame);
}
