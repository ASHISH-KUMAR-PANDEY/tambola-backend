import { io } from 'socket.io-client';

const BACKEND_URL = 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';
const PLAYER_COUNT = 5;

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  App Runner Connection Test (5 players)               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const players = [];
let connectedCount = 0;
let failedCount = 0;
const startTime = Date.now();

console.log(`Connecting ${PLAYER_COUNT} players to App Runner...\n`);

for (let i = 0; i < PLAYER_COUNT; i++) {
  const playerId = `app-runner-test-player-${i + 1}`;

  const socket = io(BACKEND_URL, {
    auth: { userId: playerId },
    transports: ['polling'],
    timeout: 20000,
  });

  socket.on('connect', () => {
    connectedCount++;
    const transport = socket.io.engine.transport.name;
    console.log(`  ✅ Player ${i + 1} connected (${socket.id})`);
    console.log(`     Transport: ${transport}`);

    if (connectedCount === PLAYER_COUNT) {
      const duration = Date.now() - startTime;
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  APP RUNNER CONNECTION TEST RESULTS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`  Backend URL: ${BACKEND_URL}`);
      console.log(`  Protocol: HTTPS`);
      console.log(`  Transport: polling`);
      console.log(`  Total players: ${PLAYER_COUNT}`);
      console.log(`  Successfully connected: ${connectedCount}`);
      console.log(`  Failed: ${failedCount}`);
      console.log(`  Total time: ${duration}ms`);
      console.log(`  Average per player: ${Math.round(duration / PLAYER_COUNT)}ms`);
      console.log('═══════════════════════════════════════════════════════════\n');
      console.log('✅ PASS: All players connected via App Runner HTTPS\n');
      console.log('🎯 App Runner backend working correctly!\n');

      players.forEach(s => s.disconnect());
      process.exit(0);
    }
  });

  socket.on('connect_error', (error) => {
    failedCount++;
    console.log(`  ❌ Player ${i + 1} failed: ${error.message}`);

    if (connectedCount + failedCount === PLAYER_COUNT) {
      console.log('\n❌ FAIL: Some connections failed\n');
      players.forEach(s => s.disconnect());
      process.exit(1);
    }
  });

  players.push(socket);
}

setTimeout(() => {
  console.log('\n❌ TIMEOUT: Not all players connected within 30 seconds');
  console.log(`Connected: ${connectedCount}/${PLAYER_COUNT}\n`);
  players.forEach(s => s.disconnect());
  process.exit(1);
}, 30000);
