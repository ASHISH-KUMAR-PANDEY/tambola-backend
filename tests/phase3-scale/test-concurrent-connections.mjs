import { io } from 'socket.io-client';

const BACKEND_URL = 'https://d2fbvh5s0z187z.cloudfront.net';
const PLAYER_COUNT = 20; // Test with 20 concurrent players

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log(`║  TEST 2: Concurrent Connections (${PLAYER_COUNT} players)           ║`);
console.log('╚════════════════════════════════════════════════════════════╝\n');

const players = [];
let connectedCount = 0;
let failedCount = 0;
const startTime = Date.now();

// Create and connect all players simultaneously
console.log(`Connecting ${PLAYER_COUNT} players simultaneously...\n`);

for (let i = 0; i < PLAYER_COUNT; i++) {
  const playerId = `concurrent-test-player-${i + 1}`;

  const socket = io(BACKEND_URL, {
    auth: { userId: playerId },
    transports: ['websocket'],
    timeout: 15000,
  });

  socket.on('connect', () => {
    connectedCount++;
    console.log(`  ✅ Player ${i + 1} connected (${socket.id})`);

    // Check if all players connected
    if (connectedCount === PLAYER_COUNT) {
      const duration = Date.now() - startTime;

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  CONCURRENT CONNECTION TEST RESULTS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`  Total players: ${PLAYER_COUNT}`);
      console.log(`  Successfully connected: ${connectedCount}`);
      console.log(`  Failed: ${failedCount}`);
      console.log(`  Total time: ${duration}ms`);
      console.log(`  Average time per player: ${Math.round(duration / PLAYER_COUNT)}ms`);
      console.log('═══════════════════════════════════════════════════════════\n');

      if (connectedCount === PLAYER_COUNT && duration < 10000) {
        console.log('✅ PASS: All players connected successfully in < 10 seconds\n');

        // Disconnect all
        players.forEach(s => s.disconnect());
        process.exit(0);
      } else {
        console.log('⚠️  WARNING: Connections took longer than expected\n');
        players.forEach(s => s.disconnect());
        process.exit(0);
      }
    }
  });

  socket.on('connect_error', (error) => {
    failedCount++;
    console.log(`  ❌ Player ${i + 1} failed: ${error.message}`);

    if (connectedCount + failedCount === PLAYER_COUNT) {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  CONCURRENT CONNECTION TEST RESULTS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`  Total players: ${PLAYER_COUNT}`);
      console.log(`  Successfully connected: ${connectedCount}`);
      console.log(`  Failed: ${failedCount}`);
      console.log('═══════════════════════════════════════════════════════════\n');
      console.log('❌ FAIL: Some connections failed\n');

      players.forEach(s => s.disconnect());
      process.exit(1);
    }
  });

  players.push(socket);
}

// Timeout after 30 seconds
setTimeout(() => {
  console.log('\n❌ TIMEOUT: Not all players connected within 30 seconds');
  console.log(`Connected: ${connectedCount}/${PLAYER_COUNT}\n`);

  players.forEach(s => s.disconnect());
  process.exit(1);
}, 30000);
