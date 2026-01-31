import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { logger } from '../utils/logger.js';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || 'tambola-promotional-images';

export async function uploadToS3(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  try {
    const key = `promotional-banners/${Date.now()}-${fileName}`;

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType,
        ACL: 'public-read', // Make file publicly accessible
      },
    });

    await upload.done();

    // Return public URL
    const imageUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

    logger.info({ key, imageUrl }, 'File uploaded to S3');
    return imageUrl;
  } catch (error) {
    logger.error({ error, fileName }, 'Failed to upload file to S3');
    throw new Error('Failed to upload file to S3');
  }
}

export async function deleteFromS3(s3Key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    await s3Client.send(command);
    logger.info({ s3Key }, 'File deleted from S3');
  } catch (error) {
    logger.error({ error, s3Key }, 'Failed to delete file from S3');
    throw new Error('Failed to delete file from S3');
  }
}

export function extractS3Key(imageUrl: string): string {
  // Extract key from URL like: https://bucket.s3.region.amazonaws.com/key
  const urlParts = imageUrl.split('.amazonaws.com/');
  if (urlParts.length === 2) {
    return urlParts[1];
  }
  throw new Error('Invalid S3 URL format');
}
