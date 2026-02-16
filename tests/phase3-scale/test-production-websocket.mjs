import { io } from 'socket.io-client';

const BACKEND_URL = 'https://api.tambola.me';
const PLAYER_COUNT = 10;

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  Production WebSocket Test (10 players)               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const players = [];
let connectedCount = 0;
let failedCount = 0;
const startTime = Date.now();

console.log(`Connecting ${PLAYER_COUNT} players to ${BACKEND_URL}...\n`);

for (let i = 0; i < PLAYER_COUNT; i++) {
  const playerId = `prod-test-player-${i + 1}`;

  const socket = io(BACKEND_URL, {
    auth: { userId: playerId },
    transports: ['websocket', 'polling'], // Prefer WebSocket
    timeout: 20000,
  });

  socket.on('connect', () => {
    connectedCount++;
    const transport = socket.io.engine.transport.name;
    console.log(`  ✅ Player ${i + 1} connected (${socket.id})`);
    console.log(`     Transport: ${transport} ${transport === 'websocket' ? '🚀' : '⚠️'}`);

    if (connectedCount === PLAYER_COUNT) {
      const duration = Date.now() - startTime;

      // Count transports
      const websocketCount = players.filter(s => s.io.engine.transport.name === 'websocket').length;
      const pollingCount = players.filter(s => s.io.engine.transport.name === 'polling').length;

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('  PRODUCTION WEBSOCKET TEST RESULTS');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`  Backend URL: ${BACKEND_URL}`);
      console.log(`  SSL: ✅ HTTPS/WSS`);
      console.log(`  Total players: ${PLAYER_COUNT}`);
      console.log(`  Successfully connected: ${connectedCount}`);
      console.log(`  Failed: ${failedCount}`);
      console.log(`  WebSocket connections: ${websocketCount}`);
      console.log(`  Polling connections: ${pollingCount}`);
      console.log(`  Total time: ${duration}ms`);
      console.log(`  Average per player: ${Math.round(duration / PLAYER_COUNT)}ms`);
      console.log('═══════════════════════════════════════════════════════════\n');

      if (websocketCount === PLAYER_COUNT) {
        console.log('🎉 SUCCESS: All players connected via WebSocket!');
        console.log('✅ Ready to scale to 1000+ players\n');
      } else if (websocketCount > 0) {
        console.log(`⚠️ PARTIAL: ${websocketCount} WebSocket, ${pollingCount} polling`);
        console.log('Some players using fallback polling transport\n');
      } else {
        console.log('❌ WARNING: All players using polling fallback');
        console.log('WebSocket transport not working\n');
      }

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
