import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://tambola:tambola_dev_password@localhost:27017/tambola_db?authSource=admin';

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URL);
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error({ error }, 'MongoDB connection failed');
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (error) {
    logger.error({ error }, 'MongoDB disconnection failed');
  }
}

// Handle connection events
mongoose.connection.on('connected', () => {
  logger.info('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  logger.error({ error: err }, 'Mongoose connection error');
});

mongoose.connection.on('disconnected', () => {
  logger.info('Mongoose disconnected from MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});
