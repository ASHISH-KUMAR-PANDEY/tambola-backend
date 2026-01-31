import mongoose, { Schema, Document } from 'mongoose';

export interface IYouTubeEmbed extends Document {
  _id: string;
  videoUrl: string;
  embedId: string; // YouTube video ID extracted from URL
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const youTubeEmbedSchema = new Schema<IYouTubeEmbed>(
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

export const YouTubeEmbed = mongoose.model<IYouTubeEmbed>(
  'YouTubeEmbed',
  youTubeEmbedSchema
);
