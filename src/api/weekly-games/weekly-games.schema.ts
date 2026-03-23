import { z } from 'zod';

export const createWeeklyGameSchema = z.object({
  prizes: z.object({
    early5: z.number().positive().optional(),
    topLine: z.number().positive().optional(),
    middleLine: z.number().positive().optional(),
    bottomLine: z.number().positive().optional(),
    fullHouse: z.number().positive(),
  }),
  revealIntervalMin: z.number().int().min(1).max(1440), // 1 min to 24 hours
  resultDate: z.string().datetime('Invalid datetime format'),
});

export const markNumberSchema = z.object({
  number: z.number().int().min(1).max(90),
});

export const claimWinSchema = z.object({
  category: z.enum(['EARLY_5', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE']),
});

export const updateWeeklyGameSchema = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  prizes: z.object({
    early5: z.number().positive().optional(),
    topLine: z.number().positive().optional(),
    middleLine: z.number().positive().optional(),
    bottomLine: z.number().positive().optional(),
    fullHouse: z.number().positive(),
  }).optional(),
});

export type CreateWeeklyGameInput = z.infer<typeof createWeeklyGameSchema>;
