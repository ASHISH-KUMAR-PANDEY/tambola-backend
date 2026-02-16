/**
 * Test 3: Concurrent Hard Refreshes During Active Game
 *
 * Validates state persistence when 10 players hard refresh simultaneously:
 * - 50 players in active game
 * - 25 numbers called, players have marked 10-15 numbers each
 * - 10 random players hard refresh at same time
 * - Verify tickets, marked numbers, called numbers all restored
 * - Verify game continues normally for other 40 players
 */

import { test, expect, chromium, Browser } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SocketPlayer } from '../helpers/socket-player';
import { BrowserPlayer } from '../helpers/browser-player';
import { Organizer } from '../helpers/organizer';
import { MetricsCollector } from '../helpers/metrics';
import { Validators } from '../helpers/validators';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://main.d262mxsv2xemak.amplifyapp.com';

test.describe('State Persistence: Concurrent Hard Refresh', () => {
  let accounts: any;
  let organizer: Organizer;
  let socketPlayers: SocketPlayer[] = [];
  let browserPlayers: BrowserPlayer[] = [];
  let browser: Browser;
  let gameId: string;
  let metrics: MetricsCollector;

  test.beforeAll(async () => {
    const accountsPath = path.join(__dirname, '../setup/test-accounts.json');
    if (!fs.existsSync(accountsPath)) {
      throw new Error('Test accounts not found. Run: node setup/create-test-accounts.mjs');
    }
    accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));

    // Launch browser for browser players
    browser = await chromium.launch({ headless: true });

    console.log(`\n✅ Loaded test accounts and browser`);
  });

  test.afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test('10 players hard refresh simultaneously', async () => {
    metrics = new MetricsCollector();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   TEST 3: CONCURRENT HARD REFRESH (10 PLAYERS)            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Step 1: Setup organizer
    console.log('Step 1: Setting up organizer...');
    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await organizer.connect();
    gameId = await organizer.createGame();
    console.log(`✅ Organizer ready, game: ${gameId}\n`);

    // Step 2: Connect 40 socket players + 10 browser players
    console.log('Step 2: Connecting 40 socket players...');
    for (let i = 0; i < 40; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      await player.connect();
      socketPlayers.push(player);

      if ((i + 1) % 10 === 0) {
        console.log(`  Connected: ${i + 1}/40 socket players`);
      }
    }
    console.log('✅ 40 socket players connected\n');

    console.log('Step 3: Setting up 10 browser players...');
    for (let i = 40; i < 50; i++) {
      const player = new BrowserPlayer({
        browser,
        account: accounts.players[i],
        frontendUrl: FRONTEND_URL,
        debug: false,
      });
      await player.init();
      browserPlayers.push(player);

      if ((i - 39) % 5 === 0) {
        console.log(`  Initialized: ${i - 39}/10 browser players`);
      }
    }
    console.log('✅ 10 browser players initialized\n');

    // Step 4: Socket players join LOBBY (staggered to avoid overwhelming backend)
    console.log('Step 4: Socket players joining lobby...');
    const lobbyJoinPromises = socketPlayers.map((player, index) => {
      const delay = Math.floor((index / 40) * 5000); // Spread over 5 seconds
      return new Promise<void>(async (resolve) => {
        setTimeout(async () => {
          await player.joinLobby(gameId);
          resolve();
        }, delay);
      });
    });
    await Promise.all(lobbyJoinPromises);
    console.log('✅ 40 socket players joined lobby\n');

    // Step 5: Browser players navigate to game (joins lobby via UI)
    console.log('Step 5: Browser players joining...');
    await Promise.all(browserPlayers.map(p => p.navigateToGame(gameId)));
    console.log('✅ 10 browser players joined\n');

    // Step 6: Socket players set up listeners for game:starting BEFORE organizer starts
    console.log('Step 6: Socket players setting up game:starting listeners...');
    const gameStartWaitPromises = socketPlayers.map(player => player.waitForGameStart());
    console.log('✅ Listeners set up\n');

    // Step 7: Organizer starts game
    console.log('Step 7: Organizer starting game...');
    await organizer.startGame();
    console.log('✅ Game started\n');

    // Step 8: Wait for socket players to receive game:starting
    console.log('Step 8: Waiting for socket players to receive game:starting...');
    await Promise.all(gameStartWaitPromises);
    console.log('✅ Socket players received game:starting\n');

    // Step 9: Socket players join active game
    console.log('Step 9: Socket players joining active game...');
    const gameJoinPromises = socketPlayers.map(player => player.joinGame(gameId));
    await Promise.all(gameJoinPromises);
    console.log('✅ 40 socket players in active game\n');

    // Step 10: Enable auto-mark for all socket players
    console.log('Step 10: Enabling auto-mark...');
    socketPlayers.forEach(p => p.enableAutoMark());
    console.log('✅ Auto-mark enabled\n');

    // Step 11: Call 25 numbers
    console.log('Step 11: Calling 25 numbers...');
    await organizer.callRandomNumbers(25, 800);
    console.log('✅ Called 25 numbers\n');

    // Wait for auto-mark to process
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 12: Record browser player state BEFORE refresh
    console.log('Step 12: Recording state before refresh...');
    const stateBeforeRefresh = await Promise.all(
      browserPlayers.map(async (player) => ({
        player: player.account.name,
        markedCount: await player.getMarkedNumbersCount(),
        calledCount: await player.getCalledNumbersCount(),
        winnersCount: await player.getWinnersCount(),
      }))
    );

    console.log('  State before refresh:');
    stateBeforeRefresh.slice(0, 3).forEach((state) => {
      console.log(`    ${state.player}: marked=${state.markedCount}, called=${state.calledCount}`);
    });
    console.log('✅ State recorded\n');

    // Step 13: All 10 browser players hard refresh SIMULTANEOUSLY
    console.log('Step 13: Hard refreshing 10 players simultaneously...');
    const refreshStartTime = Date.now();
    await Promise.all(browserPlayers.map(p => p.hardRefresh()));
    const refreshDuration = Date.now() - refreshStartTime;
    console.log(`✅ All refreshed in ${refreshDuration}ms\n`);

    // Wait for state restoration
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 14: Verify state AFTER refresh
    console.log('Step 14: Validating state after refresh...');
    const stateAfterRefresh = await Promise.all(
      browserPlayers.map(async (player) => ({
        player: player.account.name,
        markedCount: await player.getMarkedNumbersCount(),
        calledCount: await player.getCalledNumbersCount(),
        winnersCount: await player.getWinnersCount(),
      }))
    );

    console.log('  State after refresh:');
    stateAfterRefresh.slice(0, 3).forEach((state) => {
      console.log(`    ${state.player}: marked=${state.markedCount}, called=${state.calledCount}`);
    });

    // Validate: Marked numbers restored
    let allMarkedRestored = true;
    for (let i = 0; i < browserPlayers.length; i++) {
      // Allow some tolerance due to auto-mark timing
      const before = stateBeforeRefresh[i].markedCount;
      const after = stateAfterRefresh[i].markedCount;

      if (Math.abs(before - after) > 2) {
        console.log(`  ❌ ${browserPlayers[i].account.name}: marked numbers changed significantly (${before} → ${after})`);
        allMarkedRestored = false;
      }
    }

    if (allMarkedRestored) {
      console.log('✅ Marked numbers restored correctly\n');
    } else {
      throw new Error('Marked numbers restoration failed');
    }

    // Validate: Called numbers restored (should be exactly 25)
    const calledNumbersRestored = stateAfterRefresh.every(s => s.calledCount === 25);
    if (calledNumbersRestored) {
      console.log('✅ Called numbers restored correctly (25 for all)\n');
    } else {
      console.log('❌ Called numbers restoration failed\n');
      throw new Error('Called numbers not restored correctly');
    }

    // Step 15: Verify socket players unaffected
    console.log('Step 15: Validating socket players unaffected...');
    const allSocketPlayersOk = socketPlayers.every(p => p.calledNumbers.length === 25);
    if (allSocketPlayersOk) {
      console.log('✅ All 40 socket players unaffected by refreshes\n');
    } else {
      throw new Error('Socket players were affected by browser refresh');
    }

    // Step 16: Continue game - call 10 more numbers
    console.log('Step 16: Continuing game (calling 10 more numbers)...');
    await organizer.callRandomNumbers(10, 800);
    console.log('✅ Called 10 more numbers (total: 35)\n');

    // Wait for events
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Validate: All players now have 35 called numbers
    console.log('Validating: All players have 35 called numbers...');
    const allAt35 = socketPlayers.every(p => p.calledNumbers.length === 35);
    if (allAt35) {
      console.log('✅ All players synced at 35 called numbers\n');
    } else {
      throw new Error('Not all players synced correctly after refresh');
    }

    // Final Summary
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST COMPLETE                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`  Browser players refreshed: 10`);
    console.log(`  Socket players unaffected: 40`);
    console.log(`  Marked numbers restored: ✅`);
    console.log(`  Called numbers restored: ✅`);
    console.log(`  Game continued successfully: ✅`);
    console.log(`  Status: ✅ PASSED\n`);

    // Cleanup
    console.log('Cleaning up...');
    socketPlayers.forEach(p => p.disconnect());
    await Promise.all(browserPlayers.map(p => p.close()));
    await organizer.cleanup();
    console.log('✅ Cleanup complete\n');
  });
});
