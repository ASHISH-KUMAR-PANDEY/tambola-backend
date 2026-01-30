import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://tambola:tambola_dev_password@localhost:27017/tambola_db?authSource=admin';

// Connect to MongoDB
export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URL);
    logger.info('MongoDB connected');
  } catch (error) {
    logger.error({ error }, 'MongoDB connection failed');
    throw error;
  }
}

// Disconnect from MongoDB
export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (error) {
    logger.error({ error }, 'MongoDB disconnection failed');
  }
}

// Connection event handlers
mongoose.connection.on('error', (err) => {
  logger.error({ error: err }, 'MongoDB error');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

// Export mongoose for compatibility
export { mongoose };
