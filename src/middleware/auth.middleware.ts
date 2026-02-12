import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../utils/error.js';

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    userId: string;
    email: string;
    role?: 'PLAYER' | 'ORGANIZER';
  };
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();

    // Attach user info to request
    (request as AuthenticatedRequest).user = {
      userId: (request.user as any).userId,
      email: (request.user as any).email,
      role: (request.user as any).role,
    };
  } catch (error) {
    throw new AppError('UNAUTHORIZED', 'Invalid or missing authentication token', 401);
  }
}

/**
 * Optional auth middleware - does not throw if no token present
 * Used for endpoints that need to check auth but allow anonymous access
 */
export async function optionalAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();

    // Attach user info to request
    (request as AuthenticatedRequest).user = {
      userId: (request.user as any).userId,
      email: (request.user as any).email,
      role: (request.user as any).role,
    };
  } catch (error) {
    // Don't throw - just continue without user info
    // Controller can check if user is present
  }
}
