#!/usr/bin/env node
/**
 * Test win state persistence after reconnection
 *
 * Scenario:
 * 1. Player joins game
 * 2. Organizer calls numbers until player gets Early 5
 * 3. Player claims Early 5 win
 * 4. Player disconnects
 * 5. Player reconnects
 * 6. Verify: winners array includes this player's win
 * 7. Verify: marked numbers are still present
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

async function testWinStatePersistence() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     WIN STATE PERSISTENCE TEST                        ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  // Create users
  console.log('1. Creating organizer and player...');
  const organizer = await createTestUser('Org-WinTest', 'ORGANIZER');
  const player = await createTestUser('Player-WinTest', 'PLAYER');
  console.log('   ✅ Users created');

  // Create game
  console.log('\n2. Creating game...');
  const game = await createGame(organizer.token);
  console.log(`   ✅ Game created: ${game.id}`);

  // Connect organizer
  console.log('\n3. Connecting organizer...');
  const orgSocket = io(BACKEND_URL, {
    auth: { userId: organizer.id },
    transports: ['polling'],
  });

  await new Promise(resolve => orgSocket.on('connect', resolve));
  orgSocket.emit('game:join', { gameId: game.id });
  await new Promise(resolve => orgSocket.once('game:joined', resolve));
  console.log('   ✅ Organizer connected and joined');

  // Connect player
  console.log('\n4. Connecting player...');
  const playerSocket = io(BACKEND_URL, {
    auth: { userId: player.id },
    transports: ['polling'],
  });

  await new Promise(resolve => playerSocket.on('connect', resolve));

  let playerTicket = null;
  let playerId = null;

  playerSocket.emit('game:join', { gameId: game.id });
  const joinData = await new Promise(resolve => playerSocket.once('game:joined', resolve));
  playerTicket = joinData.ticket;
  playerId = joinData.playerId;
  console.log(`   ✅ Player joined (playerId: ${playerId})`);
  console.log(`   📋 Ticket: ${JSON.stringify(playerTicket)}`);

  // Start game
  console.log('\n5. Starting game...');
  orgSocket.emit('game:start', { gameId: game.id });
  await new Promise(resolve => orgSocket.once('game:started', resolve));
  console.log('   ✅ Game started');

  // Get all numbers on player's ticket for Early 5 strategy (filter out 0s which represent empty cells)
  const allNumbersOnTicket = playerTicket.flat().filter(n => n !== null && n !== 0);
  console.log(`   📊 Total numbers on ticket: ${allNumbersOnTicket.length}`);

  // Call numbers until we have at least 5 marked
  console.log('\n6. Calling numbers to enable Early 5 win...');
  let markedCount = 0;
  let numbersToCall = [];

  // Call the first 5 numbers from the ticket
  for (let i = 0; i < Math.min(5, allNumbersOnTicket.length); i++) {
    numbersToCall.push(allNumbersOnTicket[i]);
  }

  for (const num of numbersToCall) {
    // Setup listener first
    const numberCalledPromise = new Promise(resolve => {
      const handler = (data) => {
        if (data.number === num) {
          orgSocket.off('game:numberCalled', handler);
          resolve();
        }
      };
      orgSocket.on('game:numberCalled', handler);

      // Set timeout to resolve anyway after 5s
      setTimeout(() => {
        orgSocket.off('game:numberCalled', handler);
        resolve();
      }, 5000);
    });

    // Then emit
    orgSocket.emit('game:callNumber', { gameId: game.id, number: num });

    // Wait for broadcast
    await numberCalledPromise;

    // Player marks the number
    playerSocket.emit('game:markNumber', {
      gameId: game.id,
      playerId: playerId,
      number: num,
    });

    markedCount++;
    console.log(`   ✅ Called and marked number ${num} (${markedCount}/5)`);
    await sleep(300);
  }

  console.log(`   ✅ Marked ${markedCount} numbers for Early 5`);

  // Claim Early 5 win
  console.log('\n7. Claiming Early 5 win...');

  let winClaimResult = null;
  playerSocket.once('game:winClaimed', (data) => {
    winClaimResult = data;
    console.log(`   📨 Received game:winClaimed: ${JSON.stringify(data)}`);
  });

  let winnerBroadcast = null;
  playerSocket.once('game:winner', (data) => {
    winnerBroadcast = data;
    console.log(`   📨 Received game:winner broadcast: ${JSON.stringify(data)}`);
  });

  playerSocket.emit('game:claimWin', {
    gameId: game.id,
    category: 'EARLY_5',
  });

  await sleep(2000); // Wait for win processing

  if (winClaimResult) {
    console.log(`   ✅ Win claimed: ${winClaimResult.message}`);
  } else {
    console.log(`   ⚠️  No winClaimed response received`);
  }

  // Disconnect player
  console.log('\n8. Disconnecting player...');
  playerSocket.disconnect();
  await sleep(2000);
  console.log('   ✅ Player disconnected');

  // Reconnect player
  console.log('\n9. Reconnecting player...');
  const playerSocket2 = io(BACKEND_URL, {
    auth: { userId: player.id },
    transports: ['polling'],
  });

  await new Promise(resolve => playerSocket2.on('connect', resolve));
  console.log('   ✅ Player reconnected');

  // Setup stateSync listener BEFORE joining
  let stateSyncData = null;
  playerSocket2.on('game:stateSync', (data) => {
    stateSyncData = data;
  });

  // Rejoin game
  playerSocket2.emit('game:join', { gameId: game.id });
  await new Promise(resolve => playerSocket2.once('game:joined', resolve));
  console.log('   ✅ Player rejoined game');

  // Wait for stateSync
  await sleep(2000);

  // Verify state restoration
  console.log('\n10. Verifying state restoration...');

  let testsPassed = 0;
  let testsFailed = 0;

  if (stateSyncData) {
    console.log('\n   === STATE SYNC DATA ===');
    console.log(`   Called Numbers: ${stateSyncData.calledNumbers?.length || 0}`);
    console.log(`   Marked Numbers: ${stateSyncData.markedNumbers?.length || 0}`);
    console.log(`   Winners Count: ${stateSyncData.winners?.length || 0}`);

    if (stateSyncData.winners && stateSyncData.winners.length > 0) {
      console.log(`   Winners Array: ${JSON.stringify(stateSyncData.winners)}`);
    }

    // Test 1: Marked numbers restored
    console.log('\n   [Test 1] Marked numbers restored?');
    if (stateSyncData.markedNumbers && stateSyncData.markedNumbers.length === markedCount) {
      console.log(`   ✅ PASS - ${stateSyncData.markedNumbers.length} marked numbers restored`);
      testsPassed++;
    } else {
      console.log(`   ❌ FAIL - Expected ${markedCount}, got ${stateSyncData.markedNumbers?.length || 0}`);
      testsFailed++;
    }

    // Test 2: Called numbers restored
    console.log('\n   [Test 2] Called numbers restored?');
    if (stateSyncData.calledNumbers && stateSyncData.calledNumbers.length === numbersToCall.length) {
      console.log(`   ✅ PASS - ${stateSyncData.calledNumbers.length} called numbers restored`);
      testsPassed++;
    } else {
      console.log(`   ❌ FAIL - Expected ${numbersToCall.length}, got ${stateSyncData.calledNumbers?.length || 0}`);
      testsFailed++;
    }

    // Test 3: Winner status restored
    console.log('\n   [Test 3] Winner status (Early 5) restored?');
    const playerWon = stateSyncData.winners?.some(w => w.playerId === playerId && w.category === 'EARLY_5');
    if (playerWon) {
      console.log(`   ✅ PASS - Player found in winners array with EARLY_5 category`);
      testsPassed++;
    } else {
      console.log(`   ❌ FAIL - Player NOT found in winners array`);
      console.log(`      Expected: playerId=${playerId}, category=EARLY_5`);
      console.log(`      Winners: ${JSON.stringify(stateSyncData.winners)}`);
      testsFailed++;
    }

    // Test 4: Winner details correct
    console.log('\n   [Test 4] Winner details correct?');
    const winner = stateSyncData.winners?.find(w => w.playerId === playerId);
    if (winner && winner.category === 'EARLY_5') {
      console.log(`   ✅ PASS - Winner category is EARLY_5`);
      console.log(`      Winner playerId: ${winner.playerId}`);
      console.log(`      Winner category: ${winner.category}`);
      testsPassed++;
    } else {
      console.log(`   ❌ FAIL - Winner category incorrect or missing`);
      testsFailed++;
    }

  } else {
    console.log('   ❌ FAIL - No stateSync event received!');
    testsFailed = 4;
  }

  // Final summary
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║                 TEST RESULTS                          ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  console.log(`   Total Tests: ${testsPassed + testsFailed}`);
  console.log(`   ✅ Passed: ${testsPassed}`);
  console.log(`   ❌ Failed: ${testsFailed}`);
  console.log(`   Pass Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%\n`);

  if (testsPassed === 4) {
    console.log('   🎉 SUCCESS: Win state persistence is working correctly!\n');
  } else {
    console.log('   ⚠️  FAILURE: Win state persistence has issues\n');
  }

  // Cleanup
  orgSocket.disconnect();
  playerSocket2.disconnect();
  process.exit(testsFailed > 0 ? 1 : 0);
}

testWinStatePersistence().catch(error => {
  console.error('\n❌ Test crashed:', error);
  process.exit(1);
});
