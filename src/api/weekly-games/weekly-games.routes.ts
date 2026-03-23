import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './weekly-games.controller.js';

export async function weeklyGamesRoutes(fastify: FastifyInstance): Promise<void> {
  // Protected routes (organizer)
  fastify.post('/', { onRequest: authMiddleware }, controller.create);
  fastify.patch('/:gameId/status', { onRequest: authMiddleware }, controller.updateStatus);
  fastify.delete('/:gameId', { onRequest: authMiddleware }, controller.remove);

  // Public routes (players — auth via query param or JWT)
  fastify.get('/', controller.list);
  fastify.get('/:gameId', controller.get);
  fastify.post('/:gameId/join', controller.join);
  fastify.get('/:gameId/my-state', controller.myState);
  fastify.post('/:gameId/mark', controller.mark);
  fastify.post('/:gameId/claim', controller.claim);
  fastify.get('/:gameId/results', controller.results);
}
