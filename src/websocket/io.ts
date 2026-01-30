import type { Server as SocketIOServer } from 'socket.io';

// Socket.IO instance will be set after server initialization
let io: SocketIOServer | null = null;

export function setIO(ioInstance: SocketIOServer): void {
  io = ioInstance;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO instance not initialized');
  }
  return io;
}
