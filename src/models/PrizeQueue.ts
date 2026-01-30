import mongoose, { Schema, Document } from 'mongoose';
import { WinCategory } from './Winner.js';

export enum QueueStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DEAD_LETTER = 'DEAD_LETTER',
}

export interface IPrizeQueue extends Document {
  _id: string;
  userId: string;
  gameId: string;
  category: WinCategory;
  prizeValue: any;
  status: QueueStatus;
  attempts: number;
  lastAttempt?: Date;
  error?: string;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const prizeQueueSchema = new Schema<IPrizeQueue>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    gameId: {
      type: String,
      required: true,
      ref: 'Game',
    },
    category: {
      type: String,
      enum: Object.values(WinCategory),
      required: true,
    },
    prizeValue: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(QueueStatus),
      default: QueueStatus.PENDING,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastAttempt: {
      type: Date,
    },
    error: {
      type: String,
    },
    idempotencyKey: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

prizeQueueSchema.index({ userId: 1, gameId: 1, category: 1 }, { unique: true });
prizeQueueSchema.index({ status: 1, createdAt: 1 });

export const PrizeQueue = mongoose.model<IPrizeQueue>('PrizeQueue', prizeQueueSchema);
