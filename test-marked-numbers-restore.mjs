#!/usr/bin/env node
/**
 * Debug test for marked numbers restoration
 */

import { io } from 'socket.io-client';

const BACKEND_URL = 'https://jurpkxvw5m.ap-south-1.awsapprunner.com';
const API_URL = `${BACKEND_URL}/api/v1`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateEmail() {
  return `test-${Date.now()}-${Math.random().toString(36).substring(7)}@test.com`;
}

async function apiRequest(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_URL}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return await response.json();
}

async function createTestUser(name, role = 'PLAYER') {
  const email = generateEmail();
  const password = 'TestPass@123';
  const result = await apiRequest('POST', '/auth/signup', { name, email, password, role });
  return { ...result.user, email, password, token: result.token };
}

async function createGame(organizerToken) {
  const game = await apiRequest('POST', '/games', {
    scheduledTime: new Date().toISOString(),
    prizes: {
      early5: 100,
      topLine: 200,
      middleLine: 200,
      bottomLine: 200,
      fullHouse: 500,
    },
  }, organizerToken);
  return game;
}

async function testMarkedNumbersRestore() {
  console.log('\n=== Testing Marked Numbers Restoration ===\n');

  // Create users
  console.log('1. Creating organizer and player...');
  const organizer = await createTestUser('Organizer-Debug', 'ORGANIZER');
  const player = await createTestUser('Player-Debug', 'PLAYER');

  // Create game
  console.log('2. Creating game...');
  const game = await createGame(organizer.token);
  console.log(`   Game ID: ${game.id}`);

  // Connect organizer
  console.log('3. Connecting organizer...');
  const orgSocket = io(BACKEND_URL, {
    auth: { userId: organizer.id },
    transports: ['polling'],
  });

  await new Promise(resolve => orgSocket.on('connect', resolve));
  console.log('   Organizer connected');

  orgSocket.emit('game:join', { gameId: game.id });
  await new Promise(resolve => orgSocket.once('game:joined', resolve));
  console.log('   Organizer joined');

  // Connect player
  console.log('4. Connecting player...');
  const playerSocket = io(BACKEND_URL, {
    auth: { userId: player.id },
    transports: ['polling'],
  });

  await new Promise(resolve => playerSocket.on('connect', resolve));
  console.log(`   Player connected (userId: ${player.id})`);

  let playerTicket = null;
  let playerId = null;

  playerSocket.emit('game:join', { gameId: game.id });
  const joinData = await new Promise(resolve => playerSocket.once('game:joined', resolve));
  playerTicket = joinData.ticket;
  playerId = joinData.playerId;
  console.log(`   Player joined (playerId: ${playerId})`);

  // Start game
  console.log('5. Starting game...');
  orgSocket.emit('game:start', { gameId: game.id });
  await new Promise(resolve => orgSocket.once('game:started', resolve));
  console.log('   Game started');

  // Call 5 numbers
  console.log('6. Calling 5 numbers...');
  for (let i = 1; i <= 5; i++) {
    orgSocket.emit('game:callNumber', { gameId: game.id, number: i });
    await new Promise(resolve => {
      const handler = (data) => {
        if (data.number === i) {
          orgSocket.off('game:numberCalled', handler);
          resolve();
        }
      };
      orgSocket.on('game:numberCalled', handler);
    });
    console.log(`   Called number ${i}`);
    await sleep(200);
  }

  // Mark 3 numbers
  console.log('7. Marking 3 numbers...');
  const numbersToMark = [1, 2, 3];
  for (const num of numbersToMark) {
    playerSocket.emit('game:markNumber', {
      gameId: game.id,
      playerId: playerId,
      number: num,
    });
    console.log(`   Marked number ${num}`);
    await sleep(500);
  }

  console.log('   Waiting 2 seconds for marks to process...');
  await sleep(2000);

  // Disconnect player
  console.log('8. Disconnecting player...');
  playerSocket.disconnect();
  await sleep(2000);

  // Reconnect player
  console.log('9. Reconnecting player...');
  const playerSocket2 = io(BACKEND_URL, {
    auth: { userId: player.id },
    transports: ['polling'],
  });

  await new Promise(resolve => playerSocket2.on('connect', resolve));
  console.log(`   Player reconnected (userId: ${player.id})`);

  // Setup stateSync listener BEFORE joining
  let stateSyncData = null;
  playerSocket2.on('game:stateSync', (data) => {
    console.log('\n   >>> Received game:stateSync event <<<');
    console.log(`       calledNumbers: ${data.calledNumbers?.length || 0}`);
    console.log(`       currentNumber: ${data.currentNumber}`);
    console.log(`       markedNumbers: ${data.markedNumbers?.length || 0}`);
    if (data.markedNumbers && data.markedNumbers.length > 0) {
      console.log(`       markedNumbers array: [${data.markedNumbers.join(', ')}]`);
    }
    stateSyncData = data;
  });

  // Rejoin game
  playerSocket2.emit('game:join', { gameId: game.id });
  const rejoinData = await new Promise(resolve => playerSocket2.once('game:joined', resolve));
  console.log(`   Player rejoined (playerId: ${rejoinData.playerId})`);

  // Wait for stateSync
  console.log('10. Waiting for stateSync...');
  await sleep(2000);

  if (stateSyncData) {
    console.log('\n=== STATE SYNC RESULTS ===');
    console.log(`Called Numbers Count: ${stateSyncData.calledNumbers?.length || 0}`);
    console.log(`Marked Numbers Count: ${stateSyncData.markedNumbers?.length || 0}`);
    console.log(`Marked Numbers Array: ${JSON.stringify(stateSyncData.markedNumbers || [])}`);

    if (stateSyncData.markedNumbers && stateSyncData.markedNumbers.length === 3) {
      console.log('\n✅ SUCCESS: Marked numbers were restored!');
    } else {
      console.log('\n❌ FAILURE: Marked numbers were NOT restored!');
      console.log(`Expected 3 marked numbers, got ${stateSyncData.markedNumbers?.length || 0}`);
    }
  } else {
    console.log('\n❌ FAILURE: No stateSync event received!');
  }

  // Cleanup
  orgSocket.disconnect();
  playerSocket2.disconnect();
  process.exit(0);
}

testMarkedNumbersRestore().catch(error => {
  console.error('\n❌ Test crashed:', error);
  process.exit(1);
});
