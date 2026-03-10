import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './vip-cohort.controller.js';

export async function vipCohortRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Check if user is VIP (no auth required - accepts userId as query param)
  fastify.get(
    '/check',
    controller.checkVIPStatus
  );

  // Upload/Replace VIP list (organizer only)
  fastify.post(
    '/upload',
    { preHandler: [authMiddleware] },
    controller.uploadVIPList
  );

  // Download current VIP list (organizer only)
  fastify.get(
    '/download',
    { preHandler: [authMiddleware] },
    controller.downloadVIPList
  );

  // Get VIP statistics (organizer only)
  fastify.get(
    '/stats',
    { preHandler: [authMiddleware] },
    controller.getVIPStats
  );
}
