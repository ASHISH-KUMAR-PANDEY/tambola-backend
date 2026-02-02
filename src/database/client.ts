import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

// Create Prisma client instance
export const prisma = new PrismaClient({
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

// Setup event handlers
prisma.$on('warn', (e) => {
  logger.warn({ message: e.message }, 'Prisma warning');
});

prisma.$on('error', (e) => {
  logger.error({ message: e.message }, 'Prisma error');
});

// Connect to PostgreSQL
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL connected via Prisma');
  } catch (error) {
    logger.error({ error }, 'PostgreSQL connection failed');
    throw error;
  }
}

// Disconnect from PostgreSQL
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('PostgreSQL disconnected');
  } catch (error) {
    logger.error({ error }, 'PostgreSQL disconnection failed');
  }
}
