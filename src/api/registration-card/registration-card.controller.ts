import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware.js';
import { logger } from '../../utils/logger.js';

interface CreateRegistrationCardBody {
  message: string;
  targetDateTime: string;
}

interface UpdateRegistrationCardBody {
  message?: string;
  targetDateTime?: string;
  isActive?: boolean;
}

export async function createRegistrationCard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authReq = request as AuthenticatedRequest;
    const { message, targetDateTime } = request.body as CreateRegistrationCardBody;

    if (!message || !targetDateTime) {
      throw new AppError(
        'MISSING_FIELDS',
        'Message and targetDateTime are required',
        400
      );
    }

    // Validate targetDateTime
    const targetDate = new Date(targetDateTime);
    if (isNaN(targetDate.getTime())) {
      throw new AppError(
        'INVALID_DATE',
        'Invalid targetDateTime format',
        400
      );
    }

    // Deactivate any existing active cards (only one active at a time)
    await prisma.registrationCard.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    // Create new card
    const card = await prisma.registrationCard.create({
      data: {
        message,
        targetDateTime: targetDate,
        createdBy: authReq.user.userId,
        isActive: true,
      },
    });

    logger.info({ cardId: card.id, message }, 'Registration card created');

    await reply.status(201).send({
      id: card.id,
      message: card.message,
      targetDateTime: card.targetDateTime,
      isActive: card.isActive,
      createdAt: card.createdAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to create registration card');
    throw new AppError(
      'CREATE_CARD_FAILED',
      'Failed to create registration card',
      500
    );
  }
}

export async function getActiveRegistrationCard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const card = await prisma.registrationCard.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!card) {
      await reply.send({ card: null });
      return;
    }

    await reply.send({
      card: {
        id: card.id,
        message: card.message,
        targetDateTime: card.targetDateTime,
        isActive: card.isActive,
        createdAt: card.createdAt,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get registration card');
    throw new AppError(
      'GET_CARD_FAILED',
      'Failed to get registration card',
      500
    );
  }
}

export async function updateRegistrationCard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params as { id: string };
    const { message, targetDateTime, isActive } = request.body as UpdateRegistrationCardBody;

    if (!id) {
      throw new AppError('MISSING_ID', 'Card ID is required', 400);
    }

    // Check if card exists
    const existingCard = await prisma.registrationCard.findUnique({
      where: { id },
    });

    if (!existingCard) {
      throw new AppError('CARD_NOT_FOUND', 'Registration card not found', 404);
    }

    // Build update data
    const updateData: any = {};
    if (message !== undefined) updateData.message = message;
    if (targetDateTime !== undefined) {
      const targetDate = new Date(targetDateTime);
      if (isNaN(targetDate.getTime())) {
        throw new AppError('INVALID_DATE', 'Invalid targetDateTime format', 400);
      }
      updateData.targetDateTime = targetDate;
    }
    if (isActive !== undefined) updateData.isActive = isActive;

    // Update the card
    const card = await prisma.registrationCard.update({
      where: { id },
      data: updateData,
    });

    logger.info({ cardId: card.id }, 'Registration card updated');

    await reply.send({
      id: card.id,
      message: card.message,
      targetDateTime: card.targetDateTime,
      isActive: card.isActive,
      updatedAt: card.updatedAt,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to update registration card');
    throw new AppError(
      'UPDATE_CARD_FAILED',
      'Failed to update registration card',
      500
    );
  }
}

export async function deleteRegistrationCard(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params as { id: string };

    if (!id) {
      throw new AppError('MISSING_ID', 'Card ID is required', 400);
    }

    // Check if card exists
    const existingCard = await prisma.registrationCard.findUnique({
      where: { id },
    });

    if (!existingCard) {
      throw new AppError('CARD_NOT_FOUND', 'Registration card not found', 404);
    }

    // Delete from database
    await prisma.registrationCard.delete({
      where: { id },
    });

    logger.info({ cardId: id }, 'Registration card deleted');

    await reply.status(204).send();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error({ error }, 'Failed to delete registration card');
    throw new AppError(
      'DELETE_CARD_FAILED',
      'Failed to delete registration card',
      500
    );
  }
}
