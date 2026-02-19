import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './registration-card.controller.js';

export async function registrationCardRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Create registration card (organizer only)
  fastify.post(
    '/',
    { preHandler: [authMiddleware] },
    controller.createRegistrationCard
  );

  // Get active registration card (public)
  fastify.get('/', controller.getActiveRegistrationCard);

  // Update registration card (organizer only)
  fastify.put(
    '/:id',
    { preHandler: [authMiddleware] },
    controller.updateRegistrationCard
  );

  // Delete registration card (organizer only)
  fastify.delete(
    '/:id',
    { preHandler: [authMiddleware] },
    controller.deleteRegistrationCard
  );

  // Reset all reminders for a registration card (organizer only)
  fastify.post(
    '/:id/reset-reminders',
    { preHandler: [authMiddleware] },
    controller.resetAllReminders
  );
}
