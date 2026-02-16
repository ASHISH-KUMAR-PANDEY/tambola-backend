#!/usr/bin/env node
/**
 * Quick Socket.IO Connection Test
 */
import { io } from 'socket.io-client';

const BACKEND_URL = process.env.BACKEND_URL || 'http://tambola-backend-alb-1426911040.ap-south-1.elb.amazonaws.com';
const TEST_USER_ID = 'test-user-123';

console.log(`\n🧪 Testing Socket.IO connection to: ${BACKEND_URL}\n`);

const socket = io(BACKEND_URL, {
  auth: { userId: TEST_USER_ID },
  transports: ['polling', 'websocket'],
  timeout: 10000,
});

socket.on('connect', () => {
  console.log(`✅ Connected successfully!`);
  console.log(`   Socket ID: ${socket.id}`);
  console.log(`   Transport: ${socket.io.engine.transport.name}`);

  // Try upgrading to websocket
  setTimeout(() => {
    console.log(`\n📡 Current transport: ${socket.io.engine.transport.name}`);
    socket.disconnect();
    console.log('\n✅ Test passed!\n');
    process.exit(0);
  }, 2000);
});

socket.on('connect_error', (error) => {
  console.error(`❌ Connection error:`, error.message);
  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log(`\n🔌 Disconnected: ${reason}`);
});

// Timeout after 15 seconds
setTimeout(() => {
  if (!socket.connected) {
    console.error(`\n❌ Connection timeout after 15 seconds`);
    process.exit(1);
  }
}, 15000);
