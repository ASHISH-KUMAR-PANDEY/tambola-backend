/**
 * Find Exact Breaking Point Test
 *
 * This test incrementally increases player count to find
 * the exact scalability limit between 20-50 players.
 */

import { test, expect } from '@playwright/test';
import { Organizer } from '../helpers/organizer';
import { SocketPlayer } from '../helpers/socket-player';
import accounts from '../setup/test-accounts.json' with { type: 'json' };

const BACKEND_URL = 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

async function testPlayerCount(playerCount: number, organizer: Organizer): Promise<{
  success: boolean;
  joinTime: number;
  startTime?: number;
  error?: string;
}> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  TESTING WITH ${playerCount} PLAYERS`);
  console.log('='.repeat(60));

  const players: SocketPlayer[] = [];

  try {
    // Create game
    console.log(`\n📋 Creating game...`);
    const gameId = await organizer.createGame();
    console.log(`✅ Game created: ${gameId}`);

    // Connect players
    console.log(`\n🔌 Connecting ${playerCount} players...`);
    const connectStart = Date.now();

    for (let i = 0; i < playerCount; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      players.push(player);
    }

    // Connect all players
    await Promise.all(players.map(p => p.connect()));
    console.log(`✅ All ${playerCount} players connected`);

    // Join game
    console.log(`\n👥 Joining game...`);
    await Promise.all(players.map(p => p.joinGame(gameId)));
    const joinTime = Date.now() - connectStart;
    console.log(`✅ All ${playerCount} players joined in ${joinTime}ms`);

    // Start game
    console.log(`\n🎮 Starting game...`);
    const startStart = Date.now();
    await organizer.startGame(gameId);
    const startTime = Date.now() - startStart;
    console.log(`✅ Game started in ${startTime}ms`);

    // Wait a bit to ensure stability
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`\n✅ SUCCESS: ${playerCount} players work!`);

    return {
      success: true,
      joinTime,
      startTime,
    };

  } catch (error: any) {
    console.error(`\n❌ FAILED at ${playerCount} players:`, error.message);

    return {
      success: false,
      joinTime: 0,
      error: error.message,
    };
  } finally {
    // Cleanup
    console.log(`\n🧹 Cleaning up ${players.length} players...`);
    await Promise.all(players.map(p => p.disconnect()));
  }
}

test.describe('Find Breaking Point', () => {
  let organizer: Organizer;

  test.beforeAll(async () => {
    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });
    await organizer.connect();
  });

  test.afterAll(async () => {
    if (organizer) {
      await organizer.disconnect();
    }
  });

  test('Find exact breaking point between 20-50 players', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║       FIND BREAKING POINT: INCREMENTAL LOAD TEST          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const results: Array<{
      playerCount: number;
      success: boolean;
      joinTime: number;
      startTime?: number;
      error?: string;
    }> = [];

    // Test incrementally: 20, 25, 30, 35, 40, 45, 50
    const testCounts = [20, 25, 30, 35, 40, 45, 50];

    for (const count of testCounts) {
      const result = await testPlayerCount(count, organizer);
      results.push({
        playerCount: count,
        ...result,
      });

      // If this count failed, we found the limit
      if (!result.success) {
        console.log(`\n🚨 BREAKING POINT FOUND: Between ${count - 5} and ${count} players`);
        break;
      }

      // Add delay between tests to allow backend recovery
      console.log('\n⏸️  Waiting 5s before next test...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Print summary
    console.log('\n\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                  TEST RESULTS SUMMARY                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('| Players | Status  | Join Time | Start Time | Error          |');
    console.log('|---------|---------|-----------|------------|----------------|');

    for (const result of results) {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const joinTime = result.success ? `${result.joinTime}ms` : 'N/A';
      const startTime = result.startTime ? `${result.startTime}ms` : 'N/A';
      const error = result.error ? result.error.substring(0, 15) : '';

      console.log(`| ${result.playerCount.toString().padEnd(7)} | ${status} | ${joinTime.padEnd(9)} | ${startTime.padEnd(10)} | ${error} |`);
    }

    console.log('\n');

    // Find last successful count
    const lastSuccess = results.filter(r => r.success).pop();
    const firstFailure = results.find(r => !r.success);

    if (lastSuccess && firstFailure) {
      console.log('🎯 CONCLUSION:');
      console.log(`   ✅ Last working: ${lastSuccess.playerCount} players`);
      console.log(`   ❌ First failure: ${firstFailure.playerCount} players`);
      console.log(`   📊 Breaking point: Between ${lastSuccess.playerCount} and ${firstFailure.playerCount} players\n`);
    } else if (!firstFailure) {
      console.log('🎉 SUCCESS: All player counts up to 50 work!');
    } else {
      console.log('⚠️  All player counts failed');
    }

    // At least one test should succeed
    expect(results.some(r => r.success)).toBe(true);
  }, 600000); // 10 minute timeout for full incremental test
});
