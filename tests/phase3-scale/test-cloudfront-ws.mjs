import { io } from 'socket.io-client';

const BACKEND_URL = 'https://d2fbvh5s0z187z.cloudfront.net';
const PLAYER_COUNT = 5;

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  CloudFront WebSocket Test (5 players)                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const players = [];
let connectedCount = 0;
let failedCount = 0;
const startTime = Date.now();

console.log(`Connecting ${PLAYER_COUNT} players to CloudFront HTTPS endpoint...\n`);

for (let i = 0; i < PLAYER_COUNT; i++) {
  const playerId = `cloudfront-test-player-${i + 1}`;

  const socket = io(BACKEND_URL, {
    auth: { userId: playerId },
    transports: ['websocket'],
    timeout: 20000,
  });

  socket.on('connect', () => {
    connectedCount++;
    console.log(`  ✅ Player ${i + 1} connected via WSS (${socket.id})`);
    console.log(`     Protocol: ${socket.io.engine.transport.name}`);

    if (connectedCount === PLAYER_COUNT) {
      const duration = Date.now() - startTime;
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  CLOUDFRONT WEBSOCKET TEST RESULTS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`  Backend URL: ${BACKEND_URL}`);
      console.log(`  Total players: ${PLAYER_COUNT}`);
      console.log(`  Successfully connected: ${connectedCount}`);
      console.log(`  Failed: ${failedCount}`);
      console.log(`  Total time: ${duration}ms`);
      console.log(`  Average per player: ${Math.round(duration / PLAYER_COUNT)}ms`);
      console.log('═══════════════════════════════════════════════════════════\n');
      console.log('✅ PASS: All players connected via HTTPS/WSS\n');

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
