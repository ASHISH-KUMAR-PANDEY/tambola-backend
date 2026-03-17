import type { FastifyInstance } from 'fastify';
import { authMiddleware, optionalAuthMiddleware } from '../../middleware/auth.middleware.js';
import * as soloController from './solo.controller.js';

export async function soloRoutes(fastify: FastifyInstance): Promise<void> {
  // Public (auth-aware for personalization)
  fastify.get('/current-week', { onRequest: optionalAuthMiddleware }, soloController.getCurrentWeek);
  fastify.get('/leaderboard', soloController.getLeaderboard);

  // Protected routes (require auth)
  fastify.post('/start-game', { onRequest: authMiddleware }, soloController.startGame);
  fastify.post('/claim', { onRequest: authMiddleware }, soloController.claimCategory);
  fastify.get('/my-game', { onRequest: authMiddleware }, soloController.getMyGame);
  fastify.patch('/update-progress', { onRequest: authMiddleware }, soloController.updateProgress);
  fastify.post('/complete-game', { onRequest: authMiddleware }, soloController.completeGameEndpoint);

  // Admin/Organizer routes
  fastify.post('/finalize-week', { onRequest: authMiddleware }, soloController.finalizeWeekEndpoint);
  fastify.post('/configure-week', { onRequest: authMiddleware }, soloController.configureWeek);
  fastify.get('/week-config', { onRequest: authMiddleware }, soloController.getWeekConfig);
}
