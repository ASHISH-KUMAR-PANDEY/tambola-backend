import mongoose, { Schema, Document } from 'mongoose';

export interface IYouTubeLiveStream extends Document {
  _id: string;
  videoUrl: string;
  embedId: string; // YouTube video/live stream ID extracted from URL
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const youTubeLiveStreamSchema = new Schema<IYouTubeLiveStream>(
  {
    videoUrl: {
      type: String,
      required: true,
    },
    embedId: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const YouTubeLiveStream = mongoose.model<IYouTubeLiveStream>(
  'YouTubeLiveStream',
  youTubeLiveStreamSchema
);
