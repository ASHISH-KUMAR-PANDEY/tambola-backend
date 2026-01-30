import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number): number | null {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (error: Error) => {
  logger.error({ error }, 'Redis connection error');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});
