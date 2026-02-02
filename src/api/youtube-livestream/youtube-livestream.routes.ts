import type { FastifyInstance } from 'fastify';
import * as livestreamController from './youtube-livestream.controller.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';

export async function youtubeLivestreamRoutes(fastify: FastifyInstance): Promise<void> {
  // Set live stream (organizer only - requires auth)
  fastify.post('/', { onRequest: authMiddleware }, livestreamController.setYouTubeLiveStream);

  // Get current live stream (public - no auth required)
  fastify.get('/', livestreamController.getCurrentYouTubeLiveStream);

  // Delete live stream (organizer only - requires auth)
  fastify.delete('/', { onRequest: authMiddleware }, livestreamController.deleteYouTubeLiveStream);
}
