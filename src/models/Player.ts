import mongoose, { Schema, Document } from 'mongoose';

export interface IPlayer extends Document {
  _id: string;
  gameId: string;
  userId: string;
  userName: string;
  ticket: number[][];
  joinedAt: Date;
}

const playerSchema = new Schema<IPlayer>(
  {
    gameId: {
      type: String,
      required: true,
      ref: 'Game',
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    userName: {
      type: String,
      required: true,
    },
    ticket: {
      type: Schema.Types.Mixed,
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

playerSchema.index({ gameId: 1, userId: 1 }, { unique: true });

export const Player = mongoose.model<IPlayer>('Player', playerSchema);
