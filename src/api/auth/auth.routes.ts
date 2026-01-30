import type { FastifyInstance } from 'fastify';
import * as authController from './auth.controller.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Public routes
  fastify.post('/signup', authController.signup);
  fastify.post('/login', authController.login);

  // Protected route
  fastify.get('/me', authController.me);
}
