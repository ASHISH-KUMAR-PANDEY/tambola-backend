import { z } from 'zod';

export const createGameSchema = z.object({
  scheduledTime: z.string().datetime('Invalid datetime format'),
  prizes: z.object({
    early5: z.number().positive().optional(),
    topLine: z.number().positive().optional(),
    middleLine: z.number().positive().optional(),
    bottomLine: z.number().positive().optional(),
    fullHouse: z.number().positive(),
  }),
});

export const updateGameStatusSchema = z.object({
  status: z.enum(['LOBBY', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;
export type UpdateGameStatusInput = z.infer<typeof updateGameStatusSchema>;
