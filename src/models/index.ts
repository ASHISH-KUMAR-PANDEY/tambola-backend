// Export Prisma client and types
export { prisma } from '../database/client.js';
export {
  GameStatus,
  WinCategory,
  QueueStatus,
  UserRole,
  type User,
  type Game,
  type Player,
  type Winner,
  type PrizeQueue,
  type PromotionalBanner,
  type YouTubeEmbed,
  type YouTubeLiveStream,
} from '@prisma/client';

// Re-export for backward compatibility
export { GameStatus as GameStatusEnum } from '@prisma/client';
export { WinCategory as WinCategoryEnum } from '@prisma/client';
