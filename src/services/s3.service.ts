import { S3Client, PutObjectCommand, DeleteObjectCommand, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

/**
 * Check if AWS S3 is properly configured
 */
export function isS3Configured(): boolean {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';

  // Check if credentials are not empty and not placeholder values
  return (
    accessKeyId !== '' &&
    secretAccessKey !== '' &&
    !accessKeyId.startsWith('YOUR_') &&
    !secretAccessKey.startsWith('YOUR_')
  );
}

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

/**
 * Generate a presigned URL for direct browser-to-S3 upload
 * @param fileName Original file name
 * @param mimeType File MIME type (image/jpeg, image/png, image/webp)
 * @returns Object containing presignedUrl, s3Key, and publicUrl
 */
export async function generatePresignedUploadUrl(
  fileName: string,
  mimeType: string
): Promise<{ presignedUrl: string; s3Key: string; publicUrl: string }> {
  try {
    // Generate unique key with timestamp
    const s3Key = `promotional-banners/${Date.now()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: mimeType,
      // Note: Not including ACL here - will be set after validation
    });

    // Generate presigned URL that expires in 15 minutes
    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 900, // 15 minutes
    });

    // Generate the public URL that will be accessible after upload
    const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;

    logger.info({ s3Key, fileName }, 'Generated presigned upload URL');

    return {
      presignedUrl,
      s3Key,
      publicUrl,
    };
  } catch (error) {
    logger.error({ error, fileName }, 'Failed to generate presigned upload URL');
    throw new Error('Failed to generate presigned upload URL');
  }
}

/**
 * Set object ACL to public-read after upload
 */
export async function setObjectPublicRead(s3Key: string): Promise<void> {
  try {
    const command = new PutObjectAclCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ACL: 'public-read',
    });

    await s3Client.send(command);
    logger.info({ s3Key }, 'Set object ACL to public-read');
  } catch (error) {
    logger.error({ error, s3Key }, 'Failed to set object ACL');
    throw new Error('Failed to set object ACL');
  }
}
