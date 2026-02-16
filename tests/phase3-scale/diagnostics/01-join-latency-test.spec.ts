/**
 * DIAGNOSTIC TEST: Measure Join Latency at Different Scales
 *
 * Purpose: Identify at what scale the join bottleneck occurs
 * This helps validate if the issue is real and quantify its severity
 */

import { test, expect } from '@playwright/test';
import { SocketPlayer } from '../helpers/socket-player';
import { Organizer } from '../helpers/organizer';
import accounts from '../setup/test-accounts.json' with { type: 'json' };

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

test.describe('Diagnostic: Join Latency Analysis', () => {
  let organizer: Organizer;
  let gameId: string;

  test.afterEach(async () => {
    if (organizer) {
      organizer.disconnect();
    }
  });

  // Test 1: Single player join (baseline)
  test('1 player join - baseline latency', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  DIAGNOSTIC: Single Player Join Latency                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await organizer.connect();
    gameId = await organizer.createGame();
    console.log(`✅ Game created: ${gameId}\n`);

    const player = new SocketPlayer({
      account: accounts.players[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await player.connect();
    console.log('✅ Player connected');

    const joinStartTime = Date.now();
    await player.joinGame(gameId);
    const joinLatency = Date.now() - joinStartTime;

    console.log(`\n📊 RESULT: ${joinLatency}ms`);
    console.log(`Expected: < 500ms`);
    console.log(`Status: ${joinLatency < 500 ? '✅ PASS' : '⚠️ SLOW'}\n`);

    player.disconnect();

    expect(joinLatency).toBeLessThan(2000); // Allow 2s for single player
  });

  // Test 2: 5 players join sequentially
  test('5 players join sequentially', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  DIAGNOSTIC: 5 Players Sequential Join                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await organizer.connect();
    gameId = await organizer.createGame();
    console.log(`✅ Game created: ${gameId}\n`);

    const players: SocketPlayer[] = [];
    const latencies: number[] = [];

    for (let i = 0; i < 5; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      await player.connect();
      players.push(player);

      const joinStartTime = Date.now();
      await player.joinGame(gameId);
      const joinLatency = Date.now() - joinStartTime;
      latencies.push(joinLatency);

      console.log(`  Player ${i + 1}: ${joinLatency}ms`);
    }

    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const maxLatency = Math.max(...latencies);

    console.log(`\n📊 RESULTS:`);
    console.log(`  Average: ${avgLatency}ms`);
    console.log(`  Maximum: ${maxLatency}ms`);
    console.log(`  Expected: < 500ms average`);
    console.log(`  Status: ${avgLatency < 500 ? '✅ PASS' : '⚠️ DEGRADED'}\n`);

    players.forEach(p => p.disconnect());

    expect(avgLatency).toBeLessThan(1000);
  });

  // Test 3: 5 players join in parallel
  test('5 players join in parallel', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  DIAGNOSTIC: 5 Players Parallel Join                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await organizer.connect();
    gameId = await organizer.createGame();
    console.log(`✅ Game created: ${gameId}\n`);

    const players: SocketPlayer[] = [];

    // Create and connect all players
    for (let i = 0; i < 5; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      await player.connect();
      players.push(player);
    }

    console.log('✅ All 5 players connected\n');

    // Join all in parallel
    const parallelStartTime = Date.now();
    const joinPromises = players.map(async (player, index) => {
      const startTime = Date.now();
      try {
        await player.joinGame(gameId);
        return {
          index,
          success: true,
          latency: Date.now() - startTime,
        };
      } catch (error) {
        return {
          index,
          success: false,
          latency: Date.now() - startTime,
          error: String(error),
        };
      }
    });

    const results = await Promise.all(joinPromises);
    const totalTime = Date.now() - parallelStartTime;

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('📊 RESULTS:');
    console.log(`  Total time: ${totalTime}ms`);
    console.log(`  Successful: ${successful.length}/5`);
    console.log(`  Failed: ${failed.length}/5\n`);

    if (successful.length > 0) {
      const latencies = successful.map(r => r.latency);
      const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      const maxLatency = Math.max(...latencies);

      console.log(`  Join Latencies:`);
      successful.forEach(r => {
        console.log(`    Player ${r.index + 1}: ${r.latency}ms`);
      });
      console.log(`\n  Average: ${avgLatency}ms`);
      console.log(`  Maximum: ${maxLatency}ms`);
    }

    if (failed.length > 0) {
      console.log(`\n  ❌ FAILURES:`);
      failed.forEach(r => {
        console.log(`    Player ${r.index + 1}: ${r.error}`);
      });
    }

    console.log(`\n  Expected: < 2000ms total, all succeed`);
    console.log(`  Status: ${totalTime < 2000 && failed.length === 0 ? '✅ PASS' : '⚠️ BOTTLENECK DETECTED'}\n`);

    players.forEach(p => p.disconnect());

    expect(successful.length).toBeGreaterThanOrEqual(4); // Allow 1 failure
  });

  // Test 4: 10 players join in parallel
  test('10 players join in parallel', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  DIAGNOSTIC: 10 Players Parallel Join                     ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await organizer.connect();
    gameId = await organizer.createGame();
    console.log(`✅ Game created: ${gameId}\n`);

    const players: SocketPlayer[] = [];

    for (let i = 0; i < 10; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      await player.connect();
      players.push(player);
    }

    console.log('✅ All 10 players connected\n');

    const parallelStartTime = Date.now();
    const joinPromises = players.map(async (player, index) => {
      const startTime = Date.now();
      try {
        await player.joinGame(gameId);
        return {
          index,
          success: true,
          latency: Date.now() - startTime,
        };
      } catch (error) {
        return {
          index,
          success: false,
          latency: Date.now() - startTime,
          error: String(error),
        };
      }
    });

    const results = await Promise.all(joinPromises);
    const totalTime = Date.now() - parallelStartTime;

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('📊 RESULTS:');
    console.log(`  Total time: ${totalTime}ms`);
    console.log(`  Successful: ${successful.length}/10`);
    console.log(`  Failed: ${failed.length}/10\n`);

    if (successful.length > 0) {
      const latencies = successful.map(r => r.latency);
      const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);

      console.log(`  Join Latencies:`);
      console.log(`    Min: ${minLatency}ms`);
      console.log(`    Max: ${maxLatency}ms`);
      console.log(`    Avg: ${avgLatency}ms`);

      // Show distribution
      const under1s = latencies.filter(l => l < 1000).length;
      const under5s = latencies.filter(l => l < 5000).length;
      const over5s = latencies.filter(l => l >= 5000).length;

      console.log(`\n  Distribution:`);
      console.log(`    < 1s: ${under1s}`);
      console.log(`    1-5s: ${under5s - under1s}`);
      console.log(`    > 5s: ${over5s}`);
    }

    if (failed.length > 0) {
      console.log(`\n  ❌ FAILURES (${failed.length}):`);
      failed.slice(0, 3).forEach(r => {
        console.log(`    Player ${r.index + 1}: ${r.error}`);
      });
      if (failed.length > 3) {
        console.log(`    ... and ${failed.length - 3} more`);
      }
    }

    console.log(`\n  Expected: < 5000ms total, at least 8/10 succeed`);
    console.log(`  Status: ${totalTime < 5000 && failed.length <= 2 ? '✅ PASS' : '❌ BOTTLENECK CONFIRMED'}\n`);

    if (failed.length > 2) {
      console.log('  ⚠️  CRITICAL: Backend cannot handle 10 concurrent joins');
      console.log('  This confirms the bottleneck is REAL and needs immediate attention.\n');
    }

    players.forEach(p => p.disconnect());

    expect(successful.length).toBeGreaterThanOrEqual(8);
  });

  // Test 5: 20 players join in parallel (stress test)
  test('20 players join in parallel - stress test', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  DIAGNOSTIC: 20 Players Parallel Join (STRESS)            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });

    await organizer.connect();
    gameId = await organizer.createGame();
    console.log(`✅ Game created: ${gameId}\n`);

    const players: SocketPlayer[] = [];

    for (let i = 0; i < 20; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      await player.connect();
      players.push(player);
    }

    console.log('✅ All 20 players connected\n');
    console.log('⚠️  WARNING: This may take 10+ seconds and some joins may timeout\n');

    const parallelStartTime = Date.now();
    const joinPromises = players.map(async (player, index) => {
      const startTime = Date.now();
      try {
        await player.joinGame(gameId);
        return {
          index,
          success: true,
          latency: Date.now() - startTime,
        };
      } catch (error) {
        return {
          index,
          success: false,
          latency: Date.now() - startTime,
          error: String(error),
        };
      }
    });

    const results = await Promise.all(joinPromises);
    const totalTime = Date.now() - parallelStartTime;

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const timeouts = failed.filter(r => r.error.includes('timeout')).length;

    console.log('📊 RESULTS:');
    console.log(`  Total time: ${totalTime}ms`);
    console.log(`  Successful: ${successful.length}/20 (${Math.round(successful.length/0.2)}%)`);
    console.log(`  Failed: ${failed.length}/20`);
    console.log(`  Timeouts: ${timeouts}/20\n`);

    if (successful.length > 0) {
      const latencies = successful.map(r => r.latency);
      const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      const maxLatency = Math.max(...latencies);
      const minLatency = Math.min(...latencies);

      console.log(`  Join Latencies (successful only):`);
      console.log(`    Min: ${minLatency}ms`);
      console.log(`    Max: ${maxLatency}ms`);
      console.log(`    Avg: ${avgLatency}ms`);
    }

    console.log(`\n  Expected: < 10000ms total, at least 15/20 succeed`);

    if (failed.length > 5) {
      console.log(`  Status: ❌ SEVERE BOTTLENECK\n`);
      console.log('  🔥 CRITICAL FINDING:');
      console.log('     Backend CANNOT handle 20 concurrent joins');
      console.log('     This bottleneck will cause production issues\n');
      console.log('  📋 RECOMMENDED ACTIONS:');
      console.log('     1. Check backend logs for errors');
      console.log('     2. Monitor database connection pool');
      console.log('     3. Profile ticket generation performance');
      console.log('     4. Consider implementing join queue\n');
    } else if (failed.length > 2) {
      console.log(`  Status: ⚠️ BOTTLENECK CONFIRMED\n`);
    } else {
      console.log(`  Status: ✅ ACCEPTABLE (minor degradation)\n`);
    }

    players.forEach(p => p.disconnect());

    expect(successful.length).toBeGreaterThanOrEqual(15);
  });
});
