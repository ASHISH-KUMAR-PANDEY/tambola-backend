#!/usr/bin/env node
/**
 * Tambola Load Testing Script
 * Tests Phases 1, 2, 3 with 10 and 50 players
 */

import { io } from 'socket.io-client';
import crypto from 'crypto';

const BACKEND_URL = process.env.BACKEND_URL || 'https://jurpkxvw5m.ap-south-1.awsapprunner.com';
const API_URL = `${BACKEND_URL}/api/v1`;
const WS_URL = BACKEND_URL;

// Configuration
const CONFIG = {
  PHASE_1_PLAYERS: 10,
  PHASE_2_PLAYERS: 50,
  PHASE_3_PLAYERS: 50,
  NUMBER_CALL_DELAY: 3000, // 3 seconds per number (human speed)
  DISCONNECT_COUNT: 10, // Phase 3: disconnect 10 players
  RECONNECT_DELAY: 5000, // Wait 5s before reconnecting
  MID_GAME_JOIN_COUNT: 10, // Phase 3: 10 players join mid-game
  TARGET_BROADCAST_LATENCY: 500, // Target: < 500ms
  TARGET_RESPONSE_LATENCY: 200, // Target: < 200ms
};

// Metrics
const metrics = {
  phase1: null,
  phase2: null,
  phase3: null,
};

// Test data storage
const testUsers = [];
const testGames = [];

// Utility: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Utility: Generate random email
function generateEmail() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `loadtest-${timestamp}-${random}@tambola.test`;
}

// Utility: API request
async function apiRequest(method, path, data = null, token = null) {
  const url = `${API_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  };

  const response = await fetch(url, options);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Request failed');
  }
  return response.json();
}

// Create test user
async function createTestUser(name, role = 'PLAYER') {
  const email = generateEmail();
  const password = 'TestPass@123';

  try {
    const result = await apiRequest('POST', '/auth/signup', { name, email, password, role });
    const user = { ...result.user, email, password, token: result.token };
    testUsers.push(user);
    return user;
  } catch (error) {
    throw new Error(`Failed to create user ${name}: ${error.message}`);
  }
}

// Create game
async function createGame(organizerToken, gameName) {
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

  testGames.push(game.id);
  return game;
}

// Delete game
async function deleteGame(gameId, organizerToken) {
  try {
    await apiRequest('DELETE', `/games/${gameId}`, null, organizerToken);
  } catch (error) {
    console.error(`Failed to delete game ${gameId}: ${error.message}`);
  }
}

// Player class
class Player {
  constructor(user, gameId) {
    this.user = user;
    this.gameId = gameId;
    this.socket = null;
    this.connected = false;
    this.ticket = null;
    this.numbersReceived = [];
    this.latencies = [];
    this.errors = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(WS_URL, {
        auth: { userId: this.user.id },
        transports: ['polling'],
        reconnection: false,
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.socket.on('game:joined', (data) => {
        this.ticket = data.ticket;
      });

      this.socket.on('game:numberCalled', (data) => {
        const receiveTime = Date.now();
        this.numbersReceived.push({ number: data.number, receiveTime });
      });

      this.socket.on('error', (error) => {
        this.errors.push(error);
      });
    });
  }

  async joinGame() {
    return new Promise((resolve) => {
      this.socket.emit('game:join', { gameId: this.gameId, userName: this.user.name });
      this.socket.once('game:joined', () => {
        resolve();
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }

  async reconnect() {
    this.disconnect();
    await sleep(1000);
    await this.connect();
    await this.joinGame();
  }
}

// Organizer class
class Organizer {
  constructor(user, gameId) {
    this.user = user;
    this.gameId = gameId;
    this.socket = null;
    this.connected = false;
    this.callTimestamps = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(WS_URL, {
        auth: { userId: this.user.id },
        transports: ['polling'],
        reconnection: false,
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.socket.on('error', (error) => {
        console.error(`  [WS Error] ${this.user.name}:`, error);
      });
    });
  }

  async joinGame() {
    return new Promise((resolve) => {
      this.socket.emit('game:join', { gameId: this.gameId, userName: this.user.name });
      this.socket.once('game:joined', () => {
        resolve();
      });
    });
  }

  async startGame() {
    return new Promise((resolve) => {
      console.log('  Emitting game:start event...');
      this.socket.emit('game:start', { gameId: this.gameId });
      // Wait for game to fully start
      this.socket.once('game:started', () => {
        console.log('  ✅ Received game:started event');
        resolve();
      });
      // Fallback timeout
      setTimeout(() => {
        console.log('  ⏱️  game:started event timeout (3s), proceeding anyway');
        resolve();
      }, 3000);
    });
  }

  async callNumber(number) {
    const callTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error(`  [Error] Number ${number} call timeout after 10s`);
        reject(new Error(`Number call timeout for ${number}`));
      }, 10000);

      // Listen for the broadcast as confirmation
      const handler = (data) => {
        if (data.number === number) {
          clearTimeout(timeout);
          this.callTimestamps.push({ number, callTime });
          this.socket.off('game:numberCalled', handler);
          resolve();
        }
      };
      this.socket.on('game:numberCalled', handler);

      // Emit without acknowledgment callback
      console.log(`  Calling number ${number}...`);
      this.socket.emit('game:callNumber', { gameId: this.gameId, number });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }
}

// Calculate metrics
function calculateMetrics(organizer, players, phase) {
  const connectedPlayers = players.filter(p => p.connected).length;
  const connectionRate = (connectedPlayers / players.length) * 100;

  // Broadcast latencies
  const broadcastLatencies = [];
  organizer.callTimestamps.forEach(({ number, callTime }) => {
    players.forEach(player => {
      const received = player.numbersReceived.find(n => n.number === number);
      if (received) {
        broadcastLatencies.push(received.receiveTime - callTime);
      }
    });
  });

  const avgLatency = broadcastLatencies.length > 0
    ? broadcastLatencies.reduce((a, b) => a + b, 0) / broadcastLatencies.length
    : 0;

  const maxLatency = broadcastLatencies.length > 0
    ? Math.max(...broadcastLatencies)
    : 0;

  const minLatency = broadcastLatencies.length > 0
    ? Math.min(...broadcastLatencies)
    : 0;

  // Numbers received
  const numbersCalledTotal = organizer.callTimestamps.length;
  const numbersReceivedByPlayers = players.map(p => p.numbersReceived.length);
  const avgNumbersReceived = numbersReceivedByPlayers.reduce((a, b) => a + b, 0) / players.length;
  const minNumbersReceived = Math.min(...numbersReceivedByPlayers);
  const maxNumbersReceived = Math.max(...numbersReceivedByPlayers);

  // Success rate
  const expectedNumbers = numbersCalledTotal * players.length;
  const actualNumbers = numbersReceivedByPlayers.reduce((a, b) => a + b, 0);
  const deliveryRate = (actualNumbers / expectedNumbers) * 100;

  return {
    phase,
    playerCount: players.length,
    connectedPlayers,
    connectionRate: connectionRate.toFixed(2),
    numbersCalledTotal,
    avgNumbersReceived: avgNumbersReceived.toFixed(2),
    minNumbersReceived,
    maxNumbersReceived,
    deliveryRate: deliveryRate.toFixed(2),
    avgLatency: Math.round(avgLatency),
    minLatency: Math.round(minLatency),
    maxLatency: Math.round(maxLatency),
    broadcastSamples: broadcastLatencies.length,
    errors: players.reduce((acc, p) => acc + p.errors.length, 0),
    passed: connectionRate === 100 && deliveryRate > 98 && avgLatency < CONFIG.TARGET_BROADCAST_LATENCY,
  };
}

// Phase 1: Baseline (10 players)
async function runPhase1() {
  console.log('\n🔵 PHASE 1: Baseline (10 players)');
  console.log('Creating organizer and 10 players...');

  // Create users
  const organizer = await createTestUser('LoadTest-Organizer-P1', 'ORGANIZER');
  const players = [];
  for (let i = 1; i <= CONFIG.PHASE_1_PLAYERS; i++) {
    players.push(await createTestUser(`LoadTest-Player-P1-${i}`, 'PLAYER'));
  }

  // Create game
  console.log('Creating game...');
  const game = await createGame(organizer.token, 'LoadTest-Phase1');

  // Connect organizer
  console.log('Connecting organizer...');
  const org = new Organizer(organizer, game.id);
  await org.connect();
  await org.joinGame();

  // Connect all players FIRST
  console.log('Connecting 10 players...');
  const playerClients = [];
  for (const player of players) {
    const client = new Player(player, game.id);
    await client.connect();
    await client.joinGame();
    playerClients.push(client);
  }

  // NOW start the game after players joined
  console.log('Starting game with 10 players...');
  await org.startGame();
  await sleep(2000); // Wait for Redis state initialization

  // Call 90 numbers
  console.log('Calling 90 numbers (3s delay per number)...');
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (const number of numbers) {
    await org.callNumber(number);
    await sleep(CONFIG.NUMBER_CALL_DELAY);
  }

  // Wait for final broadcasts
  await sleep(2000);

  // Calculate metrics
  const results = calculateMetrics(org, playerClients, 'Phase 1');

  // Cleanup
  console.log('Cleaning up...');
  org.disconnect();
  playerClients.forEach(p => p.disconnect());
  await deleteGame(game.id, organizer.token);

  return results;
}

// Phase 2: Target Load (50 players)
async function runPhase2() {
  console.log('\n🟢 PHASE 2: Target Load (50 players)');
  console.log('Creating organizer and 50 players...');

  // Create users
  const organizer = await createTestUser('LoadTest-Organizer-P2', 'ORGANIZER');
  const players = [];
  for (let i = 1; i <= CONFIG.PHASE_2_PLAYERS; i++) {
    players.push(await createTestUser(`LoadTest-Player-P2-${i}`, 'PLAYER'));
  }

  // Create game
  console.log('Creating game...');
  const game = await createGame(organizer.token, 'LoadTest-Phase2');

  // Connect organizer
  console.log('Connecting organizer...');
  const org = new Organizer(organizer, game.id);
  await org.connect();
  await org.joinGame();

  // Connect all 50 players simultaneously FIRST
  console.log('Connecting 50 players simultaneously...');
  const playerClients = [];
  const connectionPromises = players.map(async (player) => {
    const client = new Player(player, game.id);
    await client.connect();
    await client.joinGame();
    playerClients.push(client);
  });
  await Promise.all(connectionPromises);

  // NOW start the game after all players joined
  console.log('Starting game with 50 players...');
  await org.startGame();
  await sleep(2000); // Wait for Redis state initialization

  // Call 90 numbers
  console.log('Calling 90 numbers (3s delay per number)...');
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);
  for (const number of numbers) {
    await org.callNumber(number);
    await sleep(CONFIG.NUMBER_CALL_DELAY);
  }

  // Wait for final broadcasts
  await sleep(2000);

  // Calculate metrics
  const results = calculateMetrics(org, playerClients, 'Phase 2');

  // Cleanup
  console.log('Cleaning up...');
  org.disconnect();
  playerClients.forEach(p => p.disconnect());
  await deleteGame(game.id, organizer.token);

  return results;
}

// Phase 3: Chaos Testing (50 players + disruptions)
async function runPhase3() {
  console.log('\n🟡 PHASE 3: Chaos Testing (50 players + disruptions)');
  console.log('Creating organizer and 50 players...');

  // Create users (50 initial + 10 mid-game joiners)
  const organizer = await createTestUser('LoadTest-Organizer-P3', 'ORGANIZER');
  const players = [];
  for (let i = 1; i <= CONFIG.PHASE_3_PLAYERS; i++) {
    players.push(await createTestUser(`LoadTest-Player-P3-${i}`, 'PLAYER'));
  }
  const lateJoiners = [];
  for (let i = 1; i <= CONFIG.MID_GAME_JOIN_COUNT; i++) {
    lateJoiners.push(await createTestUser(`LoadTest-LateJoiner-P3-${i}`, 'PLAYER'));
  }

  // Create game
  console.log('Creating game...');
  const game = await createGame(organizer.token, 'LoadTest-Phase3');

  // Connect organizer
  console.log('Connecting organizer...');
  const org = new Organizer(organizer, game.id);
  await org.connect();
  await org.joinGame();

  // Connect all 50 players FIRST
  console.log('Connecting 50 players...');
  const playerClients = [];
  const connectionPromises = players.map(async (player) => {
    const client = new Player(player, game.id);
    await client.connect();
    await client.joinGame();
    playerClients.push(client);
  });
  await Promise.all(connectionPromises);

  // NOW start the game after all players joined
  console.log('Starting game with 50 players...');
  await org.startGame();
  await sleep(2000); // Wait for Redis state initialization

  // Start calling numbers
  console.log('Calling numbers with chaos...');
  const numbers = Array.from({ length: 90 }, (_, i) => i + 1);

  for (let i = 0; i < numbers.length; i++) {
    const number = numbers[i];

    // After 20 numbers: Disconnect 10 random players
    if (i === 20) {
      console.log('  [Chaos] Disconnecting 10 random players...');
      const toDisconnect = playerClients
        .sort(() => Math.random() - 0.5)
        .slice(0, CONFIG.DISCONNECT_COUNT);
      toDisconnect.forEach(p => p.disconnect());
    }

    // After 25 numbers: Reconnect those players
    if (i === 25) {
      console.log('  [Chaos] Reconnecting disconnected players...');
      const disconnected = playerClients.filter(p => !p.connected);
      for (const p of disconnected) {
        try {
          await p.reconnect();
        } catch (error) {
          console.error(`  [Error] Failed to reconnect ${p.user.name}`);
        }
      }
    }

    // After 30 numbers: 10 new players join mid-game
    if (i === 30) {
      console.log('  [Chaos] 10 new players joining mid-game...');
      for (const player of lateJoiners) {
        const client = new Player(player, game.id);
        await client.connect();
        await client.joinGame();
        playerClients.push(client);
      }
    }

    await org.callNumber(number);
    await sleep(CONFIG.NUMBER_CALL_DELAY);
  }

  // Wait for final broadcasts
  await sleep(2000);

  // Calculate metrics
  const results = calculateMetrics(org, playerClients, 'Phase 3');

  // Cleanup
  console.log('Cleaning up...');
  org.disconnect();
  playerClients.forEach(p => p.disconnect());
  await deleteGame(game.id, organizer.token);

  return results;
}

// Print results
function printResults() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    LOAD TEST RESULTS                          ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const phases = [metrics.phase1, metrics.phase2, metrics.phase3].filter(Boolean);

  phases.forEach(m => {
    const status = m.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`${m.phase}: ${status}`);
    console.log(`  Players: ${m.connectedPlayers}/${m.playerCount} (${m.connectionRate}%)`);
    console.log(`  Numbers Called: ${m.numbersCalledTotal}`);
    console.log(`  Avg Numbers Received: ${m.avgNumbersReceived} (min: ${m.minNumbersReceived}, max: ${m.maxNumbersReceived})`);
    console.log(`  Delivery Rate: ${m.deliveryRate}%`);
    console.log(`  Broadcast Latency: avg ${m.avgLatency}ms, min ${m.minLatency}ms, max ${m.maxLatency}ms`);
    console.log(`  Samples: ${m.broadcastSamples}`);
    console.log(`  Errors: ${m.errors}`);
    console.log('');
  });

  console.log('Target Benchmarks:');
  console.log(`  Connection Rate: 100%`);
  console.log(`  Delivery Rate: > 98%`);
  console.log(`  Broadcast Latency: < ${CONFIG.TARGET_BROADCAST_LATENCY}ms`);
  console.log('');

  const allPassed = phases.every(m => m.passed);
  if (allPassed) {
    console.log('🎉 ALL PHASES PASSED! System is ready for production load.');
  } else {
    console.log('⚠️  SOME PHASES FAILED. Review metrics and check CloudWatch logs.');
  }

  console.log('═══════════════════════════════════════════════════════════════');
}

// Main
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           TAMBOLA LOAD TESTING                            ║');
  console.log('║           Testing Backend: ' + BACKEND_URL.padEnd(30) + '║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  try {
    // Run phases
    metrics.phase1 = await runPhase1();
    metrics.phase2 = await runPhase2();
    metrics.phase3 = await runPhase3();

    // Print results
    printResults();

    // Export metrics
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fs = await import('fs');
    fs.writeFileSync(
      `load-test-results-${timestamp}.json`,
      JSON.stringify(metrics, null, 2)
    );
    console.log(`\n📊 Detailed metrics exported to: load-test-results-${timestamp}.json`);
    console.log('📋 Check CloudWatch logs for backend performance details.');

  } catch (error) {
    console.error('\n❌ LOAD TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
main();
