#!/usr/bin/env node
/**
 * Debug script to test lobby:join event
 */

import { io } from 'socket.io-client';
import fs from 'fs';

const BACKEND_URL = 'https://api.tambola.me';
const accounts = JSON.parse(fs.readFileSync('/Users/stageadmin/tambola-game/tambola-backend/tests/phase3-scale/setup/test-accounts.json', 'utf-8'));

const testAccount = accounts.players[0];
const organizerAccount = accounts.organizers[0];

console.log('\n🔍 DEBUG: Testing lobby:join flow\n');
console.log(`Test player: ${testAccount.name} (${testAccount.id})`);
console.log(`Backend URL: ${BACKEND_URL}\n`);

// Step 1: Create game as organizer
console.log('Step 1: Creating game...');
const response = await fetch(`${BACKEND_URL}/api/v1/games`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${organizerAccount.token}`,
  },
  body: JSON.stringify({
    scheduledTime: new Date().toISOString(),
    prizes: { early5: 100, topLine: 200, middleLine: 200, bottomLine: 200, fullHouse: 500 },
  }),
});

if (!response.ok) {
  console.error(`❌ Failed to create game: ${response.status}`);
  process.exit(1);
}

const game = await response.json();
const gameId = game.id;
console.log(`✅ Game created: ${gameId}\n`);

// Step 2: Connect player socket
console.log('Step 2: Connecting player socket...');
const socket = io(BACKEND_URL, {
  auth: { userId: testAccount.id },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log(`✅ Socket connected: ${socket.id}\n`);

  // Step 3: Try to join lobby
  console.log('Step 3: Emitting lobby:join...');
  console.log(`  gameId: ${gameId}`);
  console.log(`  userName: ${testAccount.name}\n`);

  socket.emit('lobby:join', {
    gameId,
    userName: testAccount.name,
  });
});

socket.on('lobby:joined', (data) => {
  console.log('✅ SUCCESS: Received lobby:joined event');
  console.log('  Data:', JSON.stringify(data, null, 2));
  socket.disconnect();
  process.exit(0);
});

socket.on('error', (error) => {
  console.log('❌ ERROR: Received error event');
  console.log('  Error:', JSON.stringify(error, null, 2));
  socket.disconnect();
  process.exit(1);
});

socket.on('connect_error', (error) => {
  console.log('❌ CONNECTION ERROR:', error.message);
  process.exit(1);
});

socket.on('disconnect', () => {
  console.log('Socket disconnected');
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log('\n❌ TIMEOUT: No response after 10 seconds');
  console.log('   Neither lobby:joined nor error event received');
  socket.disconnect();
  process.exit(1);
}, 10000);
