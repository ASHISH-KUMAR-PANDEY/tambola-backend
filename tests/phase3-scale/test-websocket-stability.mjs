import { io } from 'socket.io-client';

const BACKEND_URL = 'http://tambola-backend-alb-1426911040.ap-south-1.elb.amazonaws.com';
const TEST_DURATION = 30000; // 30 seconds

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  TEST 1: WebSocket Connection Stability (30s)             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

let messageCount = 0;
let pingCount = 0;
let pongCount = 0;
let reconnectCount = 0;

const socket = io(BACKEND_URL, {
  auth: { userId: 'stability-test-user' },
  transports: ['websocket'],
  timeout: 10000,
});

socket.on('connect', () => {
  console.log(`✅ Connected! Socket ID: ${socket.id}`);
  console.log(`   Transport: ${socket.io.engine.transport.name}`);
  console.log(`   Starting stability test...\n`);
});

socket.on('disconnect', (reason) => {
  console.log(`\n❌ Disconnected: ${reason}`);
});

socket.on('reconnect', (attempt) => {
  reconnectCount++;
  console.log(`🔄 Reconnected after ${attempt} attempts`);
});

socket.io.engine.on('ping', () => {
  pingCount++;
});

socket.io.engine.on('pong', () => {
  pongCount++;
});

socket.on('connect_error', (error) => {
  console.error(`❌ Connection error:`, error.message);
  process.exit(1);
});

// Send test messages every 2 seconds
const interval = setInterval(() => {
  if (socket.connected) {
    messageCount++;
    socket.emit('ping', { timestamp: Date.now() });
  }
}, 2000);

setTimeout(() => {
  clearInterval(interval);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  STABILITY TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Duration: 30 seconds`);
  console.log(`  Connection: ${socket.connected ? '✅ ACTIVE' : '❌ LOST'}`);
  console.log(`  Messages sent: ${messageCount}`);
  console.log(`  Ping/Pong cycles: ${pongCount}`);
  console.log(`  Reconnections: ${reconnectCount}`);
  console.log(`  Transport: ${socket.io.engine.transport.name}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (socket.connected && reconnectCount === 0) {
    console.log('✅ PASS: Connection stable for 30 seconds\n');
    socket.disconnect();
    process.exit(0);
  } else {
    console.log('❌ FAIL: Connection unstable\n');
    socket.disconnect();
    process.exit(1);
  }
}, TEST_DURATION);
