import mongoose, { Schema, Document } from 'mongoose';

export interface IPromotionalBanner extends Document {
  _id: string;
  imageUrl: string;
  s3Key?: string; // Optional - only set when using S3 storage
  uploadedBy: string;
  width: number;
  height: number;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

const promotionalBannerSchema = new Schema<IPromotionalBanner>(
  {
    imageUrl: {
      type: String,
      required: true,
    },
    s3Key: {
      type: String,
      required: false, // Optional - only set when using S3 storage
    },
    uploadedBy: {
      type: String,
      required: true,
    },
    width: {
      type: Number,
      required: true,
    },
    height: {
      type: Number,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const PromotionalBanner = mongoose.model<IPromotionalBanner>(
  'PromotionalBanner',
  promotionalBannerSchema
);
