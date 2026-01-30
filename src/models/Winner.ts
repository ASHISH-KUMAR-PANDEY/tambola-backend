import mongoose, { Schema, Document } from 'mongoose';

export enum WinCategory {
  EARLY_5 = 'EARLY_5',
  TOP_LINE = 'TOP_LINE',
  MIDDLE_LINE = 'MIDDLE_LINE',
  BOTTOM_LINE = 'BOTTOM_LINE',
  FULL_HOUSE = 'FULL_HOUSE',
}

export interface IWinner extends Document {
  _id: string;
  gameId: string;
  playerId: string;
  category: WinCategory;
  claimedAt: Date;
  prizeClaimed: boolean;
  prizeValue?: any;
}

const winnerSchema = new Schema<IWinner>(
  {
    gameId: {
      type: String,
      required: true,
      ref: 'Game',
      index: true,
    },
    playerId: {
      type: String,
      required: true,
      ref: 'Player',
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(WinCategory),
      required: true,
    },
    claimedAt: {
      type: Date,
      default: Date.now,
    },
    prizeClaimed: {
      type: Boolean,
      default: false,
      index: true,
    },
    prizeValue: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: false,
  }
);

winnerSchema.index({ gameId: 1, category: 1 });

export const Winner = mongoose.model<IWinner>('Winner', winnerSchema);
