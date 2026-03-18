import type { FastifyInstance } from 'fastify';
import { authMiddleware, optionalAuthMiddleware } from '../../middleware/auth.middleware.js';
import * as soloController from './solo.controller.js';

export async function soloRoutes(fastify: FastifyInstance): Promise<void> {
  // Public (auth-aware for personalization)
  fastify.get('/current-week', { onRequest: optionalAuthMiddleware }, soloController.getCurrentWeek);
  fastify.get('/leaderboard', soloController.getLeaderboard);
  fastify.get('/category-rankings', soloController.getCategoryRankings);

  // Player routes (userId via query/body, same as main game)
  fastify.post('/start-game', soloController.startGame);
  fastify.post('/claim', soloController.claimCategory);
  fastify.get('/my-game', soloController.getMyGame);
  fastify.patch('/update-progress', soloController.updateProgress);
  fastify.post('/complete-game', soloController.completeGameEndpoint);

  // Admin/Organizer routes (require JWT auth)
  fastify.post('/finalize-week', { onRequest: authMiddleware }, soloController.finalizeWeekEndpoint);
  fastify.post('/configure-week', { onRequest: authMiddleware }, soloController.configureWeek);
  fastify.get('/week-config', { onRequest: authMiddleware }, soloController.getWeekConfig);
}
