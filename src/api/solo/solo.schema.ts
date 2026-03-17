import { z } from 'zod';

export const claimSchema = z.object({
  soloGameId: z.string().uuid(),
  category: z.enum(['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE']),
  currentNumberIndex: z.number().int().min(0).max(89),
});

export const updateProgressSchema = z.object({
  soloGameId: z.string().uuid(),
  currentIndex: z.number().int().min(0).max(90),
  markedNumbers: z.array(z.number().int().min(1).max(90)),
});

export const completeGameSchema = z.object({
  soloGameId: z.string().uuid(),
  markedNumbers: z.array(z.number().int().min(1).max(90)),
});

export const leaderboardQuerySchema = z.object({
  weekId: z.string().uuid().optional(),
});

export const configureWeekSchema = z.object({
  videoUrl: z.string().url(),
  numberSequence: z.array(z.number().int().min(1).max(90)).length(90),
  numberTimestamps: z.array(z.number().min(0)).length(90),
});

export type ClaimInput = z.infer<typeof claimSchema>;
export type UpdateProgressInput = z.infer<typeof updateProgressSchema>;
export type CompleteGameInput = z.infer<typeof completeGameSchema>;
export type ConfigureWeekInput = z.infer<typeof configureWeekSchema>;
