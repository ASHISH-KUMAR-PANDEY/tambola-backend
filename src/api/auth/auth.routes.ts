import type { FastifyInstance } from 'fastify';
import * as authController from './auth.controller.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Public routes
  fastify.post('/signup', authController.signup);
  fastify.post('/login', authController.login);
  fastify.post('/validate-user', authController.validateUser);
  fastify.post('/mobile-verify', authController.mobileVerify);

  // Protected route
  fastify.get('/me', authController.me);

  // NOTE: OTP routes removed - Frontend calls Stage API directly
  // Flow: Frontend → Stage API (OTP) → Frontend → Tambola (validateUser)
}
