import type { FastifyInstance } from 'fastify';
import * as authController from './auth.controller.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Public routes
  fastify.post('/signup', authController.signup);
  fastify.post('/login', authController.login);
  fastify.post('/validate-user', authController.validateUser);
  fastify.post('/mobile-verify', authController.mobileVerify);

  // OTP-based authentication routes
  fastify.post('/send-otp', authController.sendOTP);
  fastify.post('/verify-otp', authController.verifyOTP);

  // Protected routes
  fastify.get('/me', authController.me);
  fastify.patch('/update-profile', authController.updateUserProfile);
}
