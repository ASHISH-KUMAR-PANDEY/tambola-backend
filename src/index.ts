import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { Server as SocketIOServer } from 'socket.io';
import { logger } from './utils/logger.js';
import { errorHandler } from './utils/error.js';
import { connectDatabase, disconnectDatabase } from './database/client.js';
import { redis } from './database/redis.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Validate required environment variables
if (!JWT_SECRET) {
  logger.error('JWT_SECRET environment variable is required');
  process.exit(1);
}

// Create Fastify instance
const fastify = Fastify({
  logger: false, // Using custom Pino logger
});

// Register CORS
await fastify.register(cors, {
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

// Register JWT
await fastify.register(jwt, {
  secret: JWT_SECRET,
});

// Set global error handler
fastify.setErrorHandler(errorHandler);

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// API routes
import { authRoutes } from './api/auth/auth.routes.js';
import { gamesRoutes } from './api/games/games.routes.js';

await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
await fastify.register(gamesRoutes, { prefix: '/api/v1/games' });

// Socket.IO setup
const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: CORS_ORIGIN,
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Socket.IO middleware for authentication
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const decoded = fastify.jwt.verify(token as string) as any;
    socket.data.userId = decoded.userId;
    socket.data.email = decoded.email;

    next();
  } catch (error) {
    logger.error({ error }, 'Socket authentication failed');
    next(new Error('Invalid authentication token'));
  }
});

// Socket.IO event handlers
import * as gameHandlers from './websocket/handlers/game.handlers.js';

io.on('connection', (socket) => {
  logger.info(
    { socketId: socket.id, userId: socket.data.userId },
    'Client connected'
  );

  // Game event handlers with try/catch wrappers per project-context.md
  socket.on('game:join', async (payload) => {
    try {
      await gameHandlers.handleGameJoin(socket, payload);
    } catch (error) {
      logger.error({ error, socketId: socket.id, event: 'game:join' }, 'Event handler error');
      socket.emit('error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process game:join event',
      });
    }
  });

  socket.on('game:leave', async (payload) => {
    try {
      await gameHandlers.handleGameLeave(socket, payload);
    } catch (error) {
      logger.error({ error, socketId: socket.id, event: 'game:leave' }, 'Event handler error');
      socket.emit('error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process game:leave event',
      });
    }
  });

  socket.on('game:start', async (payload) => {
    try {
      await gameHandlers.handleGameStart(socket, payload);
    } catch (error) {
      logger.error({ error, socketId: socket.id, event: 'game:start' }, 'Event handler error');
      socket.emit('error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process game:start event',
      });
    }
  });

  socket.on('game:callNumber', async (payload) => {
    try {
      await gameHandlers.handleCallNumber(socket, payload);
    } catch (error) {
      logger.error({ error, socketId: socket.id, event: 'game:callNumber' }, 'Event handler error');
      socket.emit('error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process game:callNumber event',
      });
    }
  });

  socket.on('game:markNumber', async (payload) => {
    try {
      await gameHandlers.handleMarkNumber(socket, payload);
    } catch (error) {
      logger.error({ error, socketId: socket.id, event: 'game:markNumber' }, 'Event handler error');
      socket.emit('error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process game:markNumber event',
      });
    }
  });

  socket.on('game:claimWin', async (payload) => {
    try {
      await gameHandlers.handleClaimWin(socket, payload);
    } catch (error) {
      logger.error({ error, socketId: socket.id, event: 'game:claimWin' }, 'Event handler error');
      socket.emit('error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process game:claimWin event',
      });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info(
      { socketId: socket.id, userId: socket.data.userId, reason },
      'Client disconnected'
    );
  });
});

// Graceful shutdown
async function closeGracefully(signal: string): Promise<void> {
  logger.info(`Received ${signal}, closing gracefully...`);

  try {
    // Close Socket.IO
    io.close();

    // Close Fastify
    await fastify.close();

    // Close database connections
    await disconnectDatabase();
    await redis.quit();

    logger.info('Server closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => closeGracefully('SIGTERM'));
process.on('SIGINT', () => closeGracefully('SIGINT'));

// Connect to MongoDB
await connectDatabase();

// Start server
try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Server running on http://localhost:${PORT}`);
} catch (error) {
  logger.error({ error }, 'Failed to start server');
  process.exit(1);
}
