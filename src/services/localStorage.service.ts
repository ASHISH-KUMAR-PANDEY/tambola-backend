import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory in project root
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Upload file to local storage
 */
export async function uploadToLocal(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  try {
    // Generate unique filename
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(fileName);
    const uniqueFileName = `banner-${timestamp}-${randomString}${ext}`;

    // Save file to uploads directory
    const filePath = path.join(UPLOADS_DIR, uniqueFileName);
    await fs.promises.writeFile(filePath, fileBuffer);

    // Return URL that will be served by the backend
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/uploads/${uniqueFileName}`;
  } catch (error) {
    console.error('Failed to upload file to local storage:', error);
    throw new Error('Failed to upload file to local storage');
  }
}

/**
 * Delete file from local storage
 */
export async function deleteFromLocal(imageUrl: string): Promise<void> {
  try {
    // Extract filename from URL
    const fileName = path.basename(imageUrl);
    const filePath = path.join(UPLOADS_DIR, fileName);

    // Check if file exists
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (error) {
    console.error('Failed to delete file from local storage:', error);
    throw new Error('Failed to delete file from local storage');
  }
}

/**
 * Get uploads directory path (for serving static files)
 */
export function getUploadsDir(): string {
  return UPLOADS_DIR;
}
