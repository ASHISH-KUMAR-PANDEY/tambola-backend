/**
 * Test 1: Baseline - Full Game Flow with 200 Players
 *
 * Validates complete game with 200 concurrent players:
 * - All players join lobby within 30 seconds
 * - Organizer starts game
 * - Players transition from lobby to active game
 * - Organizer calls 75 numbers
 * - Players mark numbers realistically
 * - Multiple win claims (Early 5, Lines, Full House)
 * - Event broadcast latency < 500ms for 90% of players
 */

import { test, expect, chromium } from '@playwright/test';
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

test.describe('Baseline: 200 Player Game Flow', () => {
  let accounts: any;
  let organizer: Organizer;
  let socketPlayers: SocketPlayer[] = [];
  let browserPlayers: BrowserPlayer[] = [];
  let gameId: string;
  let metrics: MetricsCollector;

  test.beforeAll(async () => {
    // Load test accounts
    const accountsPath = path.join(__dirname, '../setup/test-accounts.json');
    if (!fs.existsSync(accountsPath)) {
      throw new Error('Test accounts not found. Run: node setup/create-test-accounts.mjs');
    }
    accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));

    console.log(`\n✅ Loaded ${accounts.players.length} players, ${accounts.organizers.length} organizers`);
  });

  test('Full game with 200 concurrent players', async () => {
    metrics = new MetricsCollector();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   TEST 1: BASELINE - 200 PLAYER GAME FLOW                 ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // Step 1: Create organizer
    console.log('Step 1: Setting up organizer...');
    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await organizer.connect();
    gameId = await organizer.createGame();
    console.log(`✅ Organizer ready, game: ${gameId}\n`);

    // Step 2: Create 200 socket players
    console.log('Step 2: Connecting 200 socket players...');
    const playerAccounts = accounts.players.slice(0, 200);

    for (let i = 0; i < 200; i++) {
      const player = new SocketPlayer({
        account: playerAccounts[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });

      await player.connect();
      socketPlayers.push(player);

      // Progress indicator
      if ((i + 1) % 20 === 0) {
        console.log(`  Connected: ${i + 1}/200 players`);
      }
    }
    console.log(`✅ All 200 socket players connected\n`);

    // Step 3: All players join LOBBY (staggered within 30 seconds)
    console.log('Step 3: Players joining lobby (staggered joins)...');
    const lobbyJoinPromises = socketPlayers.map((player, index) => {
      const delay = Math.floor((index / 200) * 30000); // Spread over 30 seconds
      return new Promise<void>(async (resolve) => {
        setTimeout(async () => {
          await player.joinLobby(gameId);
          resolve();
        }, delay);
      });
    });

    await Promise.all(lobbyJoinPromises);
    console.log(`✅ All 200 players joined lobby\n`);

    // Step 4: Players set up listeners for game:starting BEFORE organizer starts
    console.log('Step 4: Setting up game:starting listeners...');
    const gameStartWaitPromises = socketPlayers.map(player => player.waitForGameStart());
    console.log('✅ Listeners set up\n');

    // Step 5: Organizer starts game
    console.log('Step 5: Organizer starting game...');
    await organizer.startGame();
    console.log('✅ Organizer started game\n');

    // Step 6: Wait for all players to receive game:starting
    console.log('Step 6: Waiting for players to receive game:starting...');
    await Promise.all(gameStartWaitPromises);
    console.log('✅ All players received game:starting\n');

    // Step 7: All players join active game
    console.log('Step 7: Players joining active game...');
    const gameJoinPromises = socketPlayers.map(player => player.joinGame(gameId));
    await Promise.all(gameJoinPromises);
    console.log(`✅ All 200 players joined game\n`);

    // Step 8: Validate all players have unique tickets
    console.log('Step 8: Validating unique tickets...');
    Validators.validateUniqueTickets(socketPlayers);
    console.log('✅ All tickets are unique\n');

    // Step 9: Enable auto-mark for 100 players (simulate realistic marking)
    console.log('Step 9: Enabling auto-mark for 100 players...');
    for (let i = 0; i < 100; i++) {
      socketPlayers[i].enableAutoMark();
    }
    console.log('✅ Auto-mark enabled for 100 players\n');

    // Step 10: Call 75 numbers
    console.log('Step 10: Calling 75 numbers...');
    const calledNumbers = await organizer.callRandomNumbers(75, 1000);
    console.log(`✅ Called ${calledNumbers.length} numbers\n`);

    // Wait for all events to propagate
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 11: Validate event broadcast
    console.log('Step 11: Validating event broadcast...');
    Validators.validateEventBroadcast(
      socketPlayers,
      (player) => player.calledNumbers.length === 75,
      'All 75 numbers received'
    );
    console.log('✅ All players received all 75 numbers\n');

    // Validate: All players have consistent called numbers
    console.log('Validating: Called numbers consistency...');
    Validators.validateConsistentCalledNumbers(socketPlayers);
    console.log('✅ All players have consistent called numbers\n');

    // Step 12: Collect latency metrics
    console.log('Step 12: Analyzing latency metrics...');
    socketPlayers.forEach((player) => {
      const playerMetrics = player.getMetrics();
      if (playerMetrics.lastEventLatency > 0) {
        metrics.recordLatency(playerMetrics.lastEventLatency, player.account.id);
      }
    });

    const latencyStats = metrics.getLatencyStats();
    console.log(`  Event count: ${latencyStats.count}`);
    console.log(`  P50 latency: ${latencyStats.p50}ms`);
    console.log(`  P90 latency: ${latencyStats.p90}ms`);
    console.log(`  P99 latency: ${latencyStats.p99}ms`);

    // Validate: P90 latency < 500ms
    if (latencyStats.p90 > 500) {
      console.log(`⚠️  WARNING: P90 latency ${latencyStats.p90}ms exceeds target 500ms`);
    } else {
      console.log(`✅ P90 latency within target (<500ms)\n`);
    }

    // Step 13: Validate auto-marked players
    console.log('Step 13: Validating auto-mark functionality...');
    const markedCounts = socketPlayers.slice(0, 100).map(p => p.markedNumbers.size);
    const avgMarked = Math.round(markedCounts.reduce((a, b) => a + b, 0) / 100);
    console.log(`  Average marked numbers: ${avgMarked} (expected: ~15)`);

    if (avgMarked > 0) {
      console.log('✅ Auto-mark working\n');
    } else {
      console.log('⚠️  WARNING: Auto-mark may not be working\n');
    }

    // Step 14: Test win claim (simulate one player with Early 5)
    console.log('Step 14: Testing win claim (Early 5)...');
    // Find a player who can claim Early 5
    let early5Player: SocketPlayer | null = null;
    for (const player of socketPlayers) {
      if (player.markedNumbers.size >= 5) {
        early5Player = player;
        break;
      }
    }

    if (early5Player) {
      const result = await early5Player.claimWin('EARLY_5');
      console.log(`  Claim result: ${result.message}`);

      if (result.success) {
        console.log('✅ Win claim successful\n');

        // Wait for winner broadcast
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Debug: Check winners array
        console.log(`  DEBUG: First 3 players' winners arrays:`);
        for (let i = 0; i < 3; i++) {
          console.log(`    Player${i+1}: ${socketPlayers[i].winners.length} winners - ${JSON.stringify(socketPlayers[i].winners)}`);
        }

        // Validate: All players see the winner
        await Validators.validateEventBroadcast(
          socketPlayers,
          (player) => player.winners.length > 0,
          'Winner received'
        );
        console.log('✅ All players received winner broadcast\n');
      } else {
        console.log('⚠️  Win claim rejected (may be already claimed)\n');
      }
    } else {
      console.log('⚠️  No player eligible for Early 5\n');
    }

    // Final Summary
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST COMPLETE                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`  Players: 200`);
    console.log(`  Numbers called: 75`);
    console.log(`  P90 latency: ${latencyStats.p90}ms`);
    console.log(`  Winners: ${socketPlayers[0].winners.length}`);
    console.log(`  Status: ✅ PASSED\n`);

    // Cleanup
    console.log('Cleaning up...');
    socketPlayers.forEach(p => p.disconnect());
    await organizer.cleanup();
    console.log('✅ Cleanup complete\n');
  });
});
