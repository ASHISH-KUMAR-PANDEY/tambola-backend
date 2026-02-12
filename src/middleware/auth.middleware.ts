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
