import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import * as controller from './promotional-banner.controller.js';

export async function promotionalBannerRoutes(
  fastify: FastifyInstance
): Promise<void> {
  // Register multipart plugin for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
      files: 1, // Only one file at a time
    },
  });

  // Upload promotional banner (organizer only)
  fastify.post(
    '/upload',
    { preHandler: [authMiddleware] },
    controller.uploadBanner
  );

  // Get presigned URL for direct S3 upload (organizer only)
  fastify.post(
    '/presigned-url',
    { preHandler: [authMiddleware] },
    controller.getPresignedUploadUrl
  );

  // Validate banner after direct S3 upload (organizer only)
  fastify.post(
    '/validate',
    { preHandler: [authMiddleware] },
    controller.validateUploadedBanner
  );

  // Get current promotional banner (public)
  fastify.get('/', controller.getCurrentBanner);

  // Delete promotional banner (organizer only)
  fastify.delete(
    '/',
    { preHandler: [authMiddleware] },
    controller.deleteBanner
  );
}
