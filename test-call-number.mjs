#!/usr/bin/env node
import { io } from 'socket.io-client';

const BACKEND_URL = 'https://jurpkxvw5m.ap-south-1.awsapprunner.com';
const API_URL = `${BACKEND_URL}/api/v1`;

// Use your real organizer credentials
const organizerId = 'PUT_YOUR_ORGANIZER_ID_HERE';
const gameId = 'PUT_YOUR_GAME_ID_HERE';

async function test() {
  console.log('Connecting to WebSocket...');

  const socket = io(BACKEND_URL, {
    auth: { userId: organizerId },
    transports: ['polling'],
  });

  socket.on('connect', () => {
    console.log('✅ Connected! Socket ID:', socket.id);

    console.log('Joining game...');
    socket.emit('game:join', { gameId });

    socket.once('game:joined', () => {
      console.log('✅ Joined game!');

      console.log('Calling number 1...');
      const startTime = Date.now();

      socket.emit('game:callNumber', { gameId, number: 1 }, (response) => {
        const duration = Date.now() - startTime;
        console.log(`✅ Got callback after ${duration}ms:`, response);
        socket.disconnect();
        process.exit(0);
      });

      setTimeout(() => {
        console.log('❌ Callback timeout after 10s');
        socket.disconnect();
        process.exit(1);
      }, 10000);
    });
  });

  socket.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error.message);
    process.exit(1);
  });
}

test();
