import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { logger } from './utils/logger.js';
import { errorHandler } from './utils/error.js';
import { connectDatabase, disconnectDatabase } from './database/client.js';
import { redis } from './database/redis.js';
import { getUploadsDir } from './services/localStorage.service.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const FRONTEND_URL = process.env.FRONTEND_URL;

// Validate required environment variables
if (!JWT_SECRET) {
  logger.error('JWT_SECRET environment variable is required');
  process.exit(1);
}

// Parse CORS origins (support multiple comma-separated origins)
const allowedOrigins: string[] = [];
if (CORS_ORIGIN) {
  allowedOrigins.push(...CORS_ORIGIN.split(',').map(o => o.trim()));
}
if (FRONTEND_URL && !allowedOrigins.includes(FRONTEND_URL)) {
  allowedOrigins.push(FRONTEND_URL);
}

// Create Fastify instance
const fastify = Fastify({
  logger: false, // Using custom Pino logger
});

// Register CORS
await fastify.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Check if origin is allowed
    if (allowedOrigins.some(allowed => origin === allowed || origin.startsWith(allowed))) {
      callback(null, true);
    } else {
      logger.warn({ origin, allowedOrigins }, 'CORS: Origin not allowed');
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

// Register JWT
await fastify.register(jwt, {
  secret: JWT_SECRET,
});

// Register multipart for file uploads
await fastify.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1, // Only one file at a time
  },
});

// Register static file serving for uploads
await fastify.register(fastifyStatic, {
  root: getUploadsDir(),
  prefix: '/uploads/',
  decorateReply: false,
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
import { promotionalBannerRoutes } from './api/promotional-banner/promotional-banner.routes.js';
import { youTubeEmbedRoutes } from './api/youtube-embed/youtube-embed.routes.js';
import { youtubeLivestreamRoutes } from './api/youtube-livestream/youtube-livestream.routes.js';

await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
await fastify.register(gamesRoutes, { prefix: '/api/v1/games' });
await fastify.register(promotionalBannerRoutes, { prefix: '/api/v1/promotional-banner' });
await fastify.register(youTubeEmbedRoutes, { prefix: '/api/v1/youtube-embed' });
await fastify.register(youtubeLivestreamRoutes, { prefix: '/api/v1/youtube-livestream' });

// Socket.IO setup
const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check if origin is allowed
      if (allowedOrigins.some(allowed => origin === allowed || origin.startsWith(allowed))) {
        callback(null, true);
      } else {
        logger.warn({ origin, allowedOrigins }, 'Socket.IO CORS: Origin not allowed');
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
  },
  // Mobile-friendly settings for India network conditions
  pingTimeout: 20000,    // Wait 20s for pong (was 5s) - allows for 4G/3G handoffs
  pingInterval: 15000,   // Send ping every 15s (was 10s) - more frequent keepalive
  transports: ['websocket', 'polling'], // Support both WebSocket and HTTP polling
});

// Setup Redis adapter for multi-instance broadcasting
// This allows Socket.IO to work across multiple App Runner instances
const pubClient = redis.duplicate();
const subClient = redis.duplicate();

pubClient.on('error', (error) => {
  logger.error({ error }, 'Redis pub client error');
});

subClient.on('error', (error) => {
  logger.error({ error }, 'Redis sub client error');
});

io.adapter(createAdapter(pubClient, subClient));
logger.info('Socket.IO Redis adapter configured');

// Make io available globally for controllers
import { setIO } from './websocket/io.js';
setIO(io);

// Socket.IO middleware for authentication
io.use(async (socket, next) => {
  try {
    const userId = socket.handshake.auth.userId || socket.handshake.query.userId;

    if (!userId) {
      return next(new Error('userId required'));
    }

    // Store userId in socket data
    socket.data.userId = userId;

    next();
  } catch (error) {
    logger.error({ error }, 'Socket authentication failed');
    next(new Error('Invalid userId'));
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

  socket.on('game:callNumber', async (payload, callback) => {
    try {
      await gameHandlers.handleCallNumber(socket, payload, callback);
    } catch (error) {
      logger.error({ error, socketId: socket.id, event: 'game:callNumber' }, 'Event handler error');
      socket.emit('error', {
        code: 'HANDLER_ERROR',
        message: 'Failed to process game:callNumber event',
      });
      // Send error acknowledgment if callback provided
      if (callback && typeof callback === 'function') {
        callback({ success: false, error: 'Handler error' });
      }
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

    // Close Redis pub/sub clients
    await pubClient.quit();
    await subClient.quit();

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
