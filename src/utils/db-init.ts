import pg from 'pg';
import { logger } from './logger.js';

const { Client } = pg;

/**
 * Initialize database - creates the database if it doesn't exist
 * Only runs in development environment
 */
export async function initializeDatabase(): Promise<void> {
  // Only run in development
  if (process.env.NODE_ENV !== 'development') {
    logger.info('Skipping database initialization (not in development mode)');
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set, skipping database initialization');
    return;
  }

  try {
    // Parse the database URL to extract the database name
    const url = new URL(databaseUrl);
    const dbName = url.pathname.slice(1); // Remove leading /

    if (!dbName) {
      logger.warn('No database name in DATABASE_URL, skipping initialization');
      return;
    }

    logger.info({ dbName }, 'Checking if database exists');

    // Connect to the postgres database (default database)
    const postgresUrl = new URL(databaseUrl);
    postgresUrl.pathname = '/postgres';

    const client = new Client({
      connectionString: postgresUrl.toString(),
    });

    await client.connect();
    logger.info('Connected to postgres database');

    // Check if the database exists
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (result.rowCount === 0) {
      logger.info({ dbName }, 'Database does not exist, creating it');

      // Create the database
      await client.query(`CREATE DATABASE ${dbName}`);

      logger.info({ dbName }, 'Database created successfully');
    } else {
      logger.info({ dbName }, 'Database already exists');
    }

    await client.end();
  } catch (error) {
    logger.error({ error }, 'Failed to initialize database');
    // Don't throw - let the app continue and fail on actual connection
    // This allows for better error messages from Prisma
  }
}
