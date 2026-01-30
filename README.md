# Tambola Game Backend

Real-time multiplayer Tambola (Bingo) game backend built with Fastify, MongoDB, Socket.IO, and Redis.

## Tech Stack

- **Fastify** - HTTP server framework
- **MongoDB** with Mongoose - Database and ODM
- **Socket.IO** - Real-time WebSocket communication
- **Redis** - Game state caching and distributed locks
- **TypeScript** - Type safety
- **Pino** - Logging
- **Zod** - Schema validation
- **JWT** - Authentication

## Features

- User authentication (signup/login with JWT)
- Game creation and management (LOBBY → ACTIVE → COMPLETED lifecycle)
- Real-time number calling and ticket marking
- Win detection with distributed locking (Early 5, Lines, Full House)
- Prize distribution queue with idempotency
- Redis-based game state management for performance

## Prerequisites

- Node.js 18+ (with npm)
- Docker and Docker Compose (for MongoDB and Redis)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start MongoDB and Redis:**
   ```bash
   cd ..
   docker-compose up -d
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run in development:**
   ```bash
   npm run dev
   ```

## Environment Variables

See `.env.example` for required variables:

- `MONGODB_URL` - MongoDB connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret for JWT signing
- `PORT` - Server port (default: 3000)
- `CORS_ORIGIN` - Frontend URL for CORS

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user

### Games
- `GET /api/games` - List all games
- `POST /api/games` - Create new game (organizer)
- `DELETE /api/games/:id` - Delete game (organizer)
- `PATCH /api/games/:id/status` - Update game status

## WebSocket Events

### Client → Server
- `game:join` - Join a game room
- `game:leave` - Leave a game room
- `game:start` - Start game (organizer)
- `game:callNumber` - Call a number (organizer)
- `game:claimWin` - Claim a winning pattern

### Server → Client
- `game:joined` - Confirmation with ticket
- `game:playerJoined` - New player joined
- `game:started` - Game started
- `game:numberCalled` - Number called
- `game:winner` - Someone won
- `game:winClaimed` - Your win confirmed
- `game:completed` - Game finished
- `error` - Error occurred

## Project Structure

```
src/
├── api/              # REST API routes and controllers
├── database/         # MongoDB and Redis clients
├── models/           # Mongoose models
├── services/         # Business logic (game, prize, win-detection)
├── utils/            # Utilities (logger, JWT)
├── websocket/        # Socket.IO handlers
└── index.ts          # Main entry point
```

## License

MIT
