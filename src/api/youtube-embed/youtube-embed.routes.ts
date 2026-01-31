import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './youtube-embed.controller.js';

export async function youTubeEmbedRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Set YouTube embed (organizer only)
  fastify.post(
    '/',
    { preHandler: [authMiddleware] },
    controller.setYouTubeEmbed
  );

  // Get current YouTube embed (public)
  fastify.get('/', controller.getCurrentYouTubeEmbed);

  // Delete YouTube embed (organizer only)
  fastify.delete(
    '/',
    { preHandler: [authMiddleware] },
    controller.deleteYouTubeEmbed
  );
}
