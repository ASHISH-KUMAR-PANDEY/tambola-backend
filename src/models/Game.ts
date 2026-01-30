import mongoose, { Schema, Document } from 'mongoose';

export enum GameStatus {
  LOBBY = 'LOBBY',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface IPrizes {
  early5: number;
  topLine: number;
  middleLine: number;
  bottomLine: number;
  fullHouse: number;
}

export interface IGame extends Document {
  _id: string;
  scheduledTime: Date;
  startedAt?: Date;
  endedAt?: Date;
  status: GameStatus;
  createdBy: string;
  prizes: IPrizes;
  calledNumbers: number[];
  currentNumber?: number;
  createdAt: Date;
  updatedAt: Date;
}

const gameSchema = new Schema<IGame>(
  {
    scheduledTime: {
      type: Date,
      required: true,
    },
    startedAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: Object.values(GameStatus),
      default: GameStatus.LOBBY,
      index: true,
    },
    createdBy: {
      type: String,
      required: true,
      index: true,
    },
    prizes: {
      type: Schema.Types.Mixed,
      required: true,
    },
    calledNumbers: {
      type: [Number],
      default: [],
    },
    currentNumber: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

gameSchema.index({ scheduledTime: 1, status: 1 });

export const Game = mongoose.model<IGame>('Game', gameSchema);
