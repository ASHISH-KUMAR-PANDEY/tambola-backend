import { io } from 'socket.io-client';

const BACKEND_URL = 'http://tambola-backend-alb-1426911040.ap-south-1.elb.amazonaws.com';

console.log('Connecting to:', BACKEND_URL);

const socket = io(BACKEND_URL, {
  auth: { userId: 'test-user-123' },
  transports: ['polling', 'websocket'],
  timeout: 10000,
  reconnection: false,
});

socket.on('connect', () => {
  console.log('✅ Connected! Socket ID:', socket.id);
  console.log('Transport:', socket.io.engine.transport.name);
  
  setTimeout(() => {
    socket.disconnect();
    console.log('✅ Test passed - Backend is working!');
    process.exit(0);
  }, 2000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('❌ Timeout after 15s');
  process.exit(1);
}, 15000);
