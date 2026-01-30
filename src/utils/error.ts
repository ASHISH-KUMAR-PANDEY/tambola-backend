import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export async function errorHandler(
  error: FastifyError | AppError,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Log error with context
  logger.error({
    error: error.message,
    stack: error.stack,
    url: request.url,
    method: request.method,
    statusCode: error.statusCode || 500,
  });

  // Handle AppError
  if (error instanceof AppError) {
    await reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
    return;
  }

  // Handle Fastify validation errors
  if (error.validation) {
    await reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.validation,
      statusCode: 400,
    });
    return;
  }

  // Handle generic errors
  const statusCode = error.statusCode || 500;
  await reply.status(statusCode).send({
    error: 'INTERNAL_ERROR',
    message:
      process.env.NODE_ENV === 'development'
        ? error.message
        : 'An unexpected error occurred',
    statusCode,
  });
}
