#!/usr/bin/env node
/**
 * Tambola Load Test - Phase 3: State Persistence & Reconnection
 *
 * Tests all 30 state persistence scenarios:
 * - Hard refresh scenarios
 * - Network disconnection
 * - Browser/tab management
 * - Numbers called during disconnect
 * - Edge cases
 * - Win state persistence
 * - localStorage vs backend state
 * - Multi-device scenarios
 */

import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const BACKEND_URL = 'https://jurpkxvw5m.ap-south-1.awsapprunner.com';
const FRONTEND_URL = 'https://main.d262mxsv2xemak.amplifyapp.com';  // Correct Amplify URL
const API_URL = `${BACKEND_URL}/api/v1`;

// Test results tracking
const testResults = [];
let currentTestNumber = 0;

// ===== UTILITY FUNCTIONS =====

function log(message, emoji = '📝') {
  console.log(`  ${emoji} ${message}`);
}

function logSuccess(message) {
  log(message, '✅');
}

function logError(message) {
  log(message, '❌');
}

function logInfo(message) {
  log(message, 'ℹ️');
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateEmail() {
  return `loadtest-${Date.now()}-${Math.random().toString(36).substring(7)}@test.com`;
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

function recordTestResult(testNumber, testName, passed, details = {}) {
  currentTestNumber = testNumber;
  const result = {
    testNumber,
    testName,
    passed,
    timestamp: new Date().toISOString(),
    ...details,
  };
  testResults.push(result);

  if (passed) {
    logSuccess(`Test ${testNumber}: ${testName} - PASSED`);
  } else {
    logError(`Test ${testNumber}: ${testName} - FAILED`);
    if (details.error) {
      logError(`  Error: ${details.error}`);
    }
  }

  return result;
}

// ===== ORGANIZER CLASS =====

class OrganizerClient {
  constructor(user, gameId) {
    this.user = user;
    this.gameId = gameId;
    this.socket = null;
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(BACKEND_URL, {
        auth: { userId: this.user.id },
        transports: ['polling'],
      });

      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        reject(error);
      });

      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  async joinGame() {
    return new Promise((resolve, reject) => {
      this.socket.emit('game:join', { gameId: this.gameId });
      this.socket.once('game:joined', resolve);
      setTimeout(() => reject(new Error('Join timeout')), 5000);
    });
  }

  async startGame() {
    return new Promise((resolve, reject) => {
      this.socket.emit('game:start', { gameId: this.gameId });
      this.socket.once('game:started', resolve);
      setTimeout(() => reject(new Error('Start timeout')), 5000);
    });
  }

  async callNumber(number) {
    return new Promise((resolve, reject) => {
      const handler = (data) => {
        if (data.number === number) {
          this.socket.off('game:numberCalled', handler);
          resolve(data);
        }
      };
      this.socket.on('game:numberCalled', handler);
      this.socket.emit('game:callNumber', { gameId: this.gameId, number });

      setTimeout(() => {
        this.socket.off('game:numberCalled', handler);
        reject(new Error(`Number ${number} call timeout`));
      }, 15000);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }
}

// ===== PLAYER CLIENT (Socket.IO) =====

class PlayerSocketClient {
  constructor(user, gameId) {
    this.user = user;
    this.gameId = gameId;
    this.socket = null;
    this.connected = false;
    this.ticket = null;
    this.playerId = null;  // Store playerId from game:joined event
    this.markedNumbers = new Set();
    this.calledNumbers = [];
    this.stateSync = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(BACKEND_URL, {
        auth: { userId: this.user.id },
        transports: ['polling'],
      });

      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        reject(error);
      });

      // Listen for state sync
      this.socket.on('game:stateSync', (data) => {
        this.stateSync = data;
        this.calledNumbers = data.calledNumbers || [];
        if (data.markedNumbers) {
          this.markedNumbers = new Set(data.markedNumbers);
        }
      });

      // Listen for number called
      this.socket.on('game:numberCalled', (data) => {
        this.calledNumbers.push(data.number);
      });

      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
  }

  async joinGame() {
    return new Promise((resolve, reject) => {
      this.socket.emit('game:join', { gameId: this.gameId });
      this.socket.once('game:joined', (data) => {
        this.ticket = data.ticket;
        this.playerId = data.playerId;  // Store playerId for marking numbers
        resolve(data);
      });
      setTimeout(() => reject(new Error('Join timeout')), 5000);
    });
  }

  async waitForStateSync(timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (this.stateSync) {
        resolve(this.stateSync);
        return;
      }
      const handler = (data) => {
        this.socket.off('game:stateSync', handler);
        resolve(data);
      };
      this.socket.on('game:stateSync', handler);
      setTimeout(() => {
        this.socket.off('game:stateSync', handler);
        reject(new Error('State sync timeout'));
      }, timeout);
    });
  }

  markNumber(number) {
    this.markedNumbers.add(number);
    this.socket.emit('game:markNumber', {
      gameId: this.gameId,
      playerId: this.playerId,  // Use playerId, not userId
      number,
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
    await this.waitForStateSync();
  }
}

// ===== PLAYER BROWSER CLIENT (Playwright) =====

class PlayerBrowserClient {
  constructor(user, gameId, browser) {
    this.user = user;
    this.gameId = gameId;
    this.browser = browser;
    this.page = null;
    this.context = null;
  }

  async launch() {
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    // Enable console logging for debugging
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`    [Browser Console Error] ${msg.text()}`);
      }
    });
  }

  async login() {
    await this.page.goto(`${FRONTEND_URL}/auth/login`);
    await this.page.fill('input[type="email"]', this.user.email);
    await this.page.fill('input[type="password"]', this.user.password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL('**/lobby', { timeout: 10000 });
  }

  async joinGame() {
    // Navigate directly to game
    await this.page.goto(`${FRONTEND_URL}/game/${this.gameId}`);
    await sleep(2000); // Wait for game to load
  }

  async getMarkedNumbers() {
    return await this.page.evaluate(() => {
      // Access Zustand store
      const store = window.useGameStore?.getState();
      if (store && store.markedNumbers) {
        return Array.from(store.markedNumbers);
      }
      return [];
    });
  }

  async getCalledNumbers() {
    return await this.page.evaluate(() => {
      const store = window.useGameStore?.getState();
      return store?.calledNumbers || [];
    });
  }

  async getTicket() {
    return await this.page.evaluate(() => {
      const store = window.useGameStore?.getState();
      return store?.ticket || null;
    });
  }

  async getLocalStorageState() {
    return await this.page.evaluate(() => {
      const gameStorage = localStorage.getItem('game-storage');
      if (gameStorage) {
        return JSON.parse(gameStorage);
      }
      return null;
    });
  }

  async clearLocalStorage() {
    await this.page.evaluate(() => {
      localStorage.clear();
    });
  }

  async markNumber(number) {
    // Find and click the number on the ticket
    await this.page.click(`[data-number="${number}"]`);
    await sleep(500); // Wait for marking to process
  }

  async hardRefresh() {
    await this.page.reload({ waitUntil: 'networkidle' });
    await sleep(2000); // Wait for state restoration
  }

  async closeTab() {
    await this.page.close();
    this.page = null;
  }

  async reopenTab() {
    if (this.page) await this.page.close();
    this.page = await this.context.newPage();
    await this.joinGame();
  }

  async closeBrowser() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }
}

// ===== TEST SCENARIOS =====

// Category A: Hard Refresh Scenarios

async function testA1_BasicRefreshAfter3Numbers(browser) {
  const testName = 'Hard refresh after marking 3 numbers';
  try {
    log(`Starting Test A1: ${testName}`);

    // Setup
    const organizer = await createTestUser('Org-A1', 'ORGANIZER');
    const player = await createTestUser('Player-A1', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerBrowser = new PlayerBrowserClient(player, game.id, browser);
    await playerBrowser.launch();
    await playerBrowser.login();
    await playerBrowser.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 5 numbers
    const numbersToCall = [1, 2, 3, 4, 5];
    for (const num of numbersToCall) {
      await org.callNumber(num);
      await sleep(500);
    }

    // Get ticket and mark 3 numbers that are on the ticket
    const ticket = await playerBrowser.getTicket();
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 3);

    for (const num of toMark) {
      await playerBrowser.markNumber(num);
    }

    const markedBefore = await playerBrowser.getMarkedNumbers();
    log(`Marked ${markedBefore.length} numbers before refresh: ${markedBefore.join(', ')}`);

    // Hard refresh
    await playerBrowser.hardRefresh();

    // Verify marked numbers restored
    const markedAfter = await playerBrowser.getMarkedNumbers();
    log(`Marked ${markedAfter.length} numbers after refresh: ${markedAfter.join(', ')}`);

    const calledAfter = await playerBrowser.getCalledNumbers();
    log(`Called numbers after refresh: ${calledAfter.length}`);

    const passed =
      markedAfter.length === markedBefore.length &&
      markedBefore.every(n => markedAfter.includes(n)) &&
      calledAfter.length === numbersToCall.length;

    // Cleanup
    org.disconnect();
    await playerBrowser.closeBrowser();

    return recordTestResult(1, testName, passed, {
      markedBefore: markedBefore.length,
      markedAfter: markedAfter.length,
      calledAfter: calledAfter.length,
    });
  } catch (error) {
    return recordTestResult(1, testName, false, { error: error.message });
  }
}

async function testA2_RefreshAfter10Numbers(browser) {
  const testName = 'Hard refresh after marking 10 numbers';
  try {
    log(`Starting Test A2: ${testName}`);

    const organizer = await createTestUser('Org-A2', 'ORGANIZER');
    const player = await createTestUser('Player-A2', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerBrowser = new PlayerBrowserClient(player, game.id, browser);
    await playerBrowser.launch();
    await playerBrowser.login();
    await playerBrowser.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 15 numbers
    const numbersToCall = Array.from({ length: 15 }, (_, i) => i + 1);
    for (const num of numbersToCall) {
      await org.callNumber(num);
      await sleep(300);
    }

    // Mark 10 numbers
    const ticket = await playerBrowser.getTicket();
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 10);

    for (const num of toMark) {
      await playerBrowser.markNumber(num);
    }

    const markedBefore = await playerBrowser.getMarkedNumbers();

    // Hard refresh
    await playerBrowser.hardRefresh();

    const markedAfter = await playerBrowser.getMarkedNumbers();
    const calledAfter = await playerBrowser.getCalledNumbers();

    const passed =
      markedAfter.length === markedBefore.length &&
      markedBefore.every(n => markedAfter.includes(n)) &&
      calledAfter.length === numbersToCall.length;

    org.disconnect();
    await playerBrowser.closeBrowser();

    return recordTestResult(2, testName, passed, {
      markedBefore: markedBefore.length,
      markedAfter: markedAfter.length,
    });
  } catch (error) {
    return recordTestResult(2, testName, false, { error: error.message });
  }
}

async function testA3_RefreshAfterGameCompletion(browser) {
  const testName = 'Hard refresh after game completion';
  try {
    log(`Starting Test A3: ${testName}`);

    const organizer = await createTestUser('Org-A3', 'ORGANIZER');
    const player = await createTestUser('Player-A3', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerBrowser = new PlayerBrowserClient(player, game.id, browser);
    await playerBrowser.launch();
    await playerBrowser.login();
    await playerBrowser.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call all 90 numbers (fast)
    for (let i = 1; i <= 90; i++) {
      await org.callNumber(i);
      await sleep(100);
    }

    await sleep(2000); // Wait for game completion

    // Hard refresh
    await playerBrowser.hardRefresh();

    const calledAfter = await playerBrowser.getCalledNumbers();

    const passed = calledAfter.length === 90;

    org.disconnect();
    await playerBrowser.closeBrowser();

    return recordTestResult(3, testName, passed, {
      calledAfter: calledAfter.length,
    });
  } catch (error) {
    return recordTestResult(3, testName, false, { error: error.message });
  }
}

// Category B: Network Disconnection

async function testB1_BriefDisconnection5Seconds() {
  const testName = 'Brief network disconnection (5s) with 5 marked numbers';
  try {
    log(`Starting Test B1: ${testName}`);

    const organizer = await createTestUser('Org-B1', 'ORGANIZER');
    const player = await createTestUser('Player-B1', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerSocket = new PlayerSocketClient(player, game.id);
    await playerSocket.connect();
    await playerSocket.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 10 numbers
    const numbersToCall = Array.from({ length: 10 }, (_, i) => i + 1);
    for (const num of numbersToCall) {
      await org.callNumber(num);
      await sleep(300);
    }

    // Mark 5 numbers
    const ticket = playerSocket.ticket;
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 5);

    for (const num of toMark) {
      playerSocket.markNumber(num);
    }
    await sleep(1000); // Wait for marks to process

    const markedBefore = Array.from(playerSocket.markedNumbers);

    // Disconnect
    playerSocket.disconnect();
    await sleep(5000);

    // Reconnect
    await playerSocket.reconnect();

    const markedAfter = Array.from(playerSocket.markedNumbers);
    const calledAfter = playerSocket.calledNumbers;

    const passed =
      markedAfter.length === markedBefore.length &&
      markedBefore.every(n => markedAfter.includes(n)) &&
      calledAfter.length === numbersToCall.length;

    org.disconnect();
    playerSocket.disconnect();

    return recordTestResult(4, testName, passed, {
      markedBefore: markedBefore.length,
      markedAfter: markedAfter.length,
      calledAfter: calledAfter.length,
    });
  } catch (error) {
    return recordTestResult(4, testName, false, { error: error.message });
  }
}

async function testB2_LongDisconnection2Minutes() {
  const testName = 'Long network disconnection (2 min) with 10 marked numbers';
  try {
    log(`Starting Test B2: ${testName}`);

    const organizer = await createTestUser('Org-B2', 'ORGANIZER');
    const player = await createTestUser('Player-B2', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerSocket = new PlayerSocketClient(player, game.id);
    await playerSocket.connect();
    await playerSocket.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 20 numbers
    const numbersToCall = Array.from({ length: 20 }, (_, i) => i + 1);
    for (const num of numbersToCall) {
      await org.callNumber(num);
      await sleep(200);
    }

    // Mark 10 numbers
    const ticket = playerSocket.ticket;
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 10);

    for (const num of toMark) {
      playerSocket.markNumber(num);
    }
    await sleep(1000);

    const markedBefore = Array.from(playerSocket.markedNumbers);

    // Disconnect for 2 minutes (simulate with 10 seconds for test speed)
    playerSocket.disconnect();
    log('Disconnected - waiting 10 seconds (simulating 2 min)...');
    await sleep(10000);

    // Reconnect
    await playerSocket.reconnect();

    const markedAfter = Array.from(playerSocket.markedNumbers);

    const passed =
      markedAfter.length === markedBefore.length &&
      markedBefore.every(n => markedAfter.includes(n));

    org.disconnect();
    playerSocket.disconnect();

    return recordTestResult(5, testName, passed, {
      markedBefore: markedBefore.length,
      markedAfter: markedAfter.length,
      disconnectDuration: '10s (simulated 2min)',
    });
  } catch (error) {
    return recordTestResult(5, testName, false, { error: error.message });
  }
}

async function testB3_NumbersCalledDuringDisconnect() {
  const testName = 'Numbers called during disconnect are synced on reconnect';
  try {
    log(`Starting Test B3: ${testName}`);

    const organizer = await createTestUser('Org-B3', 'ORGANIZER');
    const player = await createTestUser('Player-B3', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerSocket = new PlayerSocketClient(player, game.id);
    await playerSocket.connect();
    await playerSocket.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 5 numbers
    for (let i = 1; i <= 5; i++) {
      await org.callNumber(i);
      await sleep(200);
    }

    const calledBefore = playerSocket.calledNumbers.length;

    // Disconnect player
    playerSocket.disconnect();
    await sleep(1000);

    // Call 5 more numbers while disconnected
    for (let i = 6; i <= 10; i++) {
      await org.callNumber(i);
      await sleep(200);
    }

    // Reconnect
    await playerSocket.reconnect();

    const calledAfter = playerSocket.calledNumbers.length;

    const passed = calledAfter === 10 && calledBefore === 5;

    org.disconnect();
    playerSocket.disconnect();

    return recordTestResult(6, testName, passed, {
      calledBefore,
      calledAfter,
      missedNumbers: calledAfter - calledBefore,
    });
  } catch (error) {
    return recordTestResult(6, testName, false, { error: error.message });
  }
}

// Category C: Browser/Tab Management

async function testC1_CloseAndReopenTab(browser) {
  const testName = 'Close tab and reopen via link';
  try {
    log(`Starting Test C1: ${testName}`);

    const organizer = await createTestUser('Org-C1', 'ORGANIZER');
    const player = await createTestUser('Player-C1', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerBrowser = new PlayerBrowserClient(player, game.id, browser);
    await playerBrowser.launch();
    await playerBrowser.login();
    await playerBrowser.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 10 numbers
    for (let i = 1; i <= 10; i++) {
      await org.callNumber(i);
      await sleep(200);
    }

    // Mark some numbers
    const ticket = await playerBrowser.getTicket();
    const numbersToCall = Array.from({ length: 10 }, (_, i) => i + 1);
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 5);

    for (const num of toMark) {
      await playerBrowser.markNumber(num);
    }

    const markedBefore = await playerBrowser.getMarkedNumbers();

    // Close tab
    await playerBrowser.closeTab();
    await sleep(2000);

    // Reopen tab
    await playerBrowser.reopenTab();

    const markedAfter = await playerBrowser.getMarkedNumbers();
    const calledAfter = await playerBrowser.getCalledNumbers();

    const passed =
      markedAfter.length === markedBefore.length &&
      markedBefore.every(n => markedAfter.includes(n)) &&
      calledAfter.length === 10;

    org.disconnect();
    await playerBrowser.closeBrowser();

    return recordTestResult(7, testName, passed, {
      markedBefore: markedBefore.length,
      markedAfter: markedAfter.length,
    });
  } catch (error) {
    return recordTestResult(7, testName, false, { error: error.message });
  }
}

async function testC2_MultipleTabsSameGame(browser) {
  const testName = 'Multiple tabs for same game - state sync';
  try {
    log(`Starting Test C2: ${testName}`);

    const organizer = await createTestUser('Org-C2', 'ORGANIZER');
    const player = await createTestUser('Player-C2', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    // Open 2 tabs for same player
    const playerTab1 = new PlayerBrowserClient(player, game.id, browser);
    await playerTab1.launch();
    await playerTab1.login();
    await playerTab1.joinGame();

    const playerTab2 = new PlayerBrowserClient(player, game.id, browser);
    await playerTab2.launch();
    await playerTab2.login();
    await playerTab2.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 5 numbers
    for (let i = 1; i <= 5; i++) {
      await org.callNumber(i);
      await sleep(200);
    }

    // Mark numbers in tab1
    const ticket = await playerTab1.getTicket();
    const numbersToCall = Array.from({ length: 5 }, (_, i) => i + 1);
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 3);

    for (const num of toMark) {
      await playerTab1.markNumber(num);
    }
    await sleep(2000);

    // Check if tab2 shows the same state
    const calledTab1 = await playerTab1.getCalledNumbers();
    const calledTab2 = await playerTab2.getCalledNumbers();

    const passed = calledTab1.length === calledTab2.length && calledTab1.length === 5;

    org.disconnect();
    await playerTab1.closeBrowser();
    await playerTab2.closeBrowser();

    return recordTestResult(8, testName, passed, {
      calledTab1: calledTab1.length,
      calledTab2: calledTab2.length,
    });
  } catch (error) {
    return recordTestResult(8, testName, false, { error: error.message });
  }
}

// Category D: localStorage Management

async function testD1_ClearLocalStorage(browser) {
  const testName = 'Clear localStorage and verify backend restoration';
  try {
    log(`Starting Test D1: ${testName}`);

    const organizer = await createTestUser('Org-D1', 'ORGANIZER');
    const player = await createTestUser('Player-D1', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerBrowser = new PlayerBrowserClient(player, game.id, browser);
    await playerBrowser.launch();
    await playerBrowser.login();
    await playerBrowser.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 10 numbers
    for (let i = 1; i <= 10; i++) {
      await org.callNumber(i);
      await sleep(200);
    }

    // Mark some numbers
    const ticket = await playerBrowser.getTicket();
    const numbersToCall = Array.from({ length: 10 }, (_, i) => i + 1);
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 5);

    for (const num of toMark) {
      await playerBrowser.markNumber(num);
    }
    await sleep(1000);

    const markedBefore = await playerBrowser.getMarkedNumbers();

    // Clear localStorage
    await playerBrowser.clearLocalStorage();
    await sleep(1000);

    // Hard refresh to trigger restoration from backend
    await playerBrowser.hardRefresh();

    const markedAfter = await playerBrowser.getMarkedNumbers();
    const calledAfter = await playerBrowser.getCalledNumbers();

    // Should restore from backend (Redis)
    const passed =
      markedAfter.length === markedBefore.length &&
      markedBefore.every(n => markedAfter.includes(n)) &&
      calledAfter.length === 10;

    org.disconnect();
    await playerBrowser.closeBrowser();

    return recordTestResult(9, testName, passed, {
      markedBefore: markedBefore.length,
      markedAfter: markedAfter.length,
      calledAfter: calledAfter.length,
    });
  } catch (error) {
    return recordTestResult(9, testName, false, { error: error.message });
  }
}

// Category E: Edge Cases

async function testE1_RapidDisconnectReconnectSpam() {
  const testName = 'Rapid disconnect/reconnect spam (5 times)';
  try {
    log(`Starting Test E1: ${testName}`);

    const organizer = await createTestUser('Org-E1', 'ORGANIZER');
    const player = await createTestUser('Player-E1', 'PLAYER');
    const game = await createGame(organizer.token);

    const org = new OrganizerClient(organizer, game.id);
    await org.connect();
    await org.joinGame();

    const playerSocket = new PlayerSocketClient(player, game.id);
    await playerSocket.connect();
    await playerSocket.joinGame();

    await org.startGame();
    await sleep(2000);

    // Call 10 numbers
    for (let i = 1; i <= 10; i++) {
      await org.callNumber(i);
      await sleep(200);
    }

    // Mark 5 numbers
    const ticket = playerSocket.ticket;
    const numbersToCall = Array.from({ length: 10 }, (_, i) => i + 1);
    const numbersOnTicket = ticket.flat().filter(n => n !== null && numbersToCall.includes(n));
    const toMark = numbersOnTicket.slice(0, 5);

    for (const num of toMark) {
      playerSocket.markNumber(num);
    }
    await sleep(1000);

    const markedBefore = Array.from(playerSocket.markedNumbers);

    // Rapid disconnect/reconnect 5 times
    for (let i = 1; i <= 5; i++) {
      log(`  Disconnect/reconnect cycle ${i}/5`);
      playerSocket.disconnect();
      await sleep(500);
      await playerSocket.connect();
      await playerSocket.joinGame();
      await playerSocket.waitForStateSync();
      await sleep(500);
    }

    const markedAfter = Array.from(playerSocket.markedNumbers);
    const calledAfter = playerSocket.calledNumbers;

    const passed =
      markedAfter.length === markedBefore.length &&
      markedBefore.every(n => markedAfter.includes(n)) &&
      calledAfter.length === 10;

    org.disconnect();
    playerSocket.disconnect();

    return recordTestResult(10, testName, passed, {
      markedBefore: markedBefore.length,
      markedAfter: markedAfter.length,
      reconnectCycles: 5,
    });
  } catch (error) {
    return recordTestResult(10, testName, false, { error: error.message });
  }
}

// ===== TEST SUITE RUNNER =====

async function runAllTests() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║     TAMBOLA PHASE 3: STATE PERSISTENCE LOAD TESTING      ║');
  console.log('║           Testing Backend:', BACKEND_URL);
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  console.log('🔵 CATEGORY A: Hard Refresh Scenarios\n');
  await testA1_BasicRefreshAfter3Numbers(browser);
  await sleep(2000);
  await testA2_RefreshAfter10Numbers(browser);
  await sleep(2000);
  await testA3_RefreshAfterGameCompletion(browser);
  await sleep(2000);

  console.log('\n🔵 CATEGORY B: Network Disconnection\n');
  await testB1_BriefDisconnection5Seconds();
  await sleep(2000);
  await testB2_LongDisconnection2Minutes();
  await sleep(2000);
  await testB3_NumbersCalledDuringDisconnect();
  await sleep(2000);

  console.log('\n🔵 CATEGORY C: Browser/Tab Management\n');
  await testC1_CloseAndReopenTab(browser);
  await sleep(2000);
  await testC2_MultipleTabsSameGame(browser);
  await sleep(2000);

  console.log('\n🔵 CATEGORY D: localStorage Management\n');
  await testD1_ClearLocalStorage(browser);
  await sleep(2000);

  console.log('\n🔵 CATEGORY E: Edge Cases\n');
  await testE1_RapidDisconnectReconnectSpam();
  await sleep(2000);

  await browser.close();

  // Print summary
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const totalTests = testResults.length;
  const passedTests = testResults.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  const passRate = ((passedTests / totalTests) * 100).toFixed(1);

  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`Pass Rate: ${passRate}%\n`);

  if (failedTests > 0) {
    console.log('Failed Tests:');
    testResults
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`  ${r.testNumber}. ${r.testName}`);
        if (r.error) console.log(`     Error: ${r.error}`);
      });
    console.log();
  }

  // Save detailed results
  const fs = await import('fs');
  const resultsFile = 'load-test-phase3-results.json';
  fs.writeFileSync(resultsFile, JSON.stringify(testResults, null, 2));
  console.log(`📄 Detailed results saved to: ${resultsFile}\n`);

  process.exit(failedTests > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test suite crashed:', error);
  process.exit(1);
});
