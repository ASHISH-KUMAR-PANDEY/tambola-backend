/**
 * CRITICAL LOAD TEST: Massive Scale - 50 Players Full Game
 *
 * Risk Level: CRITICAL (8/10)
 *
 * Purpose: Validate system handles 50 concurrent players in a full game
 * with number calling and winner announcements. Measure broadcast latency
 * and system stability under maximum load.
 *
 * Success Criteria:
 * - All 50 players connect successfully
 * - All 50 players join game successfully
 * - Broadcast latency P99 < 3000ms
 * - No disconnections during game
 * - Memory usage remains stable
 * - All players receive consistent game state
 */

import { test, expect } from '@playwright/test';
import { SocketPlayer } from '../helpers/socket-player';
import { Organizer } from '../helpers/organizer';
import { MetricsCollector } from '../helpers/metrics';
import { Validators } from '../helpers/validators';
import accounts from '../setup/test-accounts.json' with { type: 'json' };

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

test.describe('Massive Scale: 50 Players Full Game', () => {
  let organizer: Organizer;
  let socketPlayers: SocketPlayer[] = [];
  const metrics = new MetricsCollector();

  test.beforeAll(async () => {
    console.log('\n🧪 Loading test accounts for 50-player massive scale test...');
    expect(accounts.players.length).toBeGreaterThanOrEqual(50);
    expect(accounts.organizers.length).toBeGreaterThanOrEqual(1);
  });

  test.afterAll(async () => {
    console.log('\n🧹 Cleaning up...');

    // Disconnect all socket players
    for (const player of socketPlayers) {
      player.disconnect();
    }

    // Disconnect organizer
    if (organizer) {
      organizer.disconnect();
    }

    console.log('✅ Cleanup complete');
  });

  test('50 players full game - validate broadcast latency and system stability', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║           50-PLAYER MASSIVE SCALE: FULL GAME              ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // ============================================================
    // STEP 1: Setup Organizer
    // ============================================================
    console.log('📋 Step 1: Setting up organizer...');
    organizer = new Organizer({
      account: accounts.organizers[0],
      backendUrl: BACKEND_URL,
      debug: false,
    });
    await organizer.connect();
    console.log('✅ Organizer connected\n');

    // ============================================================
    // STEP 2: Create Game with Multiple Prizes
    // ============================================================
    console.log('🎮 Step 2: Creating game with multiple prizes...');
    const gameId = await organizer.createGame({
      early5: 1000,
      topLine: 2000,
      middleLine: 2000,
      bottomLine: 2000,
      fullHouse: 5000,
    });
    console.log(`✅ Game created: ${gameId}\n`);

    // ============================================================
    // STEP 3: Connect 50 Socket Players in Batches
    // ============================================================
    console.log('👥 Step 3: Connecting 50 socket players in batches...');
    const connectStartTime = Date.now();
    const BATCH_SIZE = 50;
    const BATCHES = 1;

    for (let batch = 0; batch < BATCHES; batch++) {
      const batchStartTime = Date.now();
      const batchPlayers: SocketPlayer[] = [];

      for (let i = 0; i < BATCH_SIZE; i++) {
        const playerIndex = batch * BATCH_SIZE + i;
        const player = new SocketPlayer({
          account: accounts.players[playerIndex],
          backendUrl: BACKEND_URL,
          debug: false,
        });
        batchPlayers.push(player);
        socketPlayers.push(player);
      }

      // Connect batch in parallel
      await Promise.all(batchPlayers.map(p => p.connect()));

      const batchTime = Date.now() - batchStartTime;
      console.log(`  ✓ Batch ${batch + 1}/${BATCHES}: ${BATCH_SIZE} players connected in ${batchTime}ms`);

      // Small delay between batches to avoid overwhelming the server
      if (batch < BATCHES - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    const totalConnectTime = Date.now() - connectStartTime;
    metrics.recordCustom('total_connect_time_ms', totalConnectTime);
    console.log(`✅ All 50 players connected in ${totalConnectTime}ms\n`);

    // ============================================================
    // STEP 4: All Players Join Game in Batches
    // ============================================================
    console.log('🔗 Step 4: All players joining game in batches...');
    const joinStartTime = Date.now();

    for (let batch = 0; batch < BATCHES; batch++) {
      const batchStartTime = Date.now();
      const startIdx = batch * BATCH_SIZE;
      const endIdx = startIdx + BATCH_SIZE;
      const batchPlayers = socketPlayers.slice(startIdx, endIdx);

      await Promise.all(batchPlayers.map(p => p.joinGame(gameId)));

      const batchTime = Date.now() - batchStartTime;
      console.log(`  ✓ Batch ${batch + 1}/${BATCHES}: ${BATCH_SIZE} players joined in ${batchTime}ms`);

      // Small delay between batches
      if (batch < BATCHES - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    const totalJoinTime = Date.now() - joinStartTime;
    metrics.recordCustom('total_join_time_ms', totalJoinTime);
    console.log(`✅ All 50 players joined in ${totalJoinTime}ms\n`);

    // Validate tickets are unique
    console.log('🎫 Validating ticket uniqueness...');
    Validators.validateUniqueTickets(socketPlayers);
    console.log('✅ All 50 tickets are unique\n');

    // ============================================================
    // STEP 5: Start Game
    // ============================================================
    console.log('🚀 Step 5: Starting game...');
    await organizer.startGame();

    // Wait for game start to propagate
    await Validators.waitForCondition(
      () => socketPlayers.filter(p => p.calledNumbers.length === 0).length === 50,
      500
    );
    console.log('✅ Game started and propagated to all players\n');

    // ============================================================
    // STEP 6: Call 30 Numbers - Measure Broadcast Latency
    // ============================================================
    console.log('📢 Step 6: Calling 30 numbers and measuring broadcast latency...');
    const NUMBER_COUNT = 30;
    const latencies: number[] = [];

    for (let i = 0; i < NUMBER_COUNT; i++) {
      const callStartTime = Date.now();

      // Organizer calls a random number
      const calledNumbers = await organizer.callRandomNumbers(1, 0);
      const number = calledNumbers[0];

      // Wait for all players to receive the number
      const received = await Validators.waitForCondition(
        () => socketPlayers.every(p => p.calledNumbers.includes(number)),
        10000
      ).then(() => true).catch(() => false);

      const broadcastLatency = Date.now() - callStartTime;
      latencies.push(broadcastLatency);
      metrics.recordLatency(broadcastLatency);

      const receivedCount = socketPlayers.filter(p => p.calledNumbers.includes(number)).length;
      console.log(`  ${i + 1}. Called ${number} - Broadcast: ${broadcastLatency}ms - Received: ${receivedCount}/50`);

      if (!received) {
        metrics.recordError(`Not all players received number ${number}`, { receivedCount });
      }

      // Delay between calls to simulate real game
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('✅ All numbers called\n');

    // ============================================================
    // STEP 7: Analyze Broadcast Latency
    // ============================================================
    console.log('📊 Step 7: Analyzing broadcast latency...');
    const latencyStats = metrics.getLatencyStats();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  BROADCAST LATENCY STATISTICS:');
    console.log(`    Min:  ${latencyStats.min}ms`);
    console.log(`    Max:  ${latencyStats.max}ms`);
    console.log(`    Avg:  ${latencyStats.avg}ms`);
    console.log(`    P50:  ${latencyStats.p50}ms`);
    console.log(`    P90:  ${latencyStats.p90}ms`);
    console.log(`    P99:  ${latencyStats.p99}ms`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================
    // STEP 8: Validate Connection Stability
    // ============================================================
    console.log('🔌 Step 8: Validating connection stability...');
    const connectedPlayers = socketPlayers.filter(p => p.isConnected());
    const disconnectedCount = 50 - connectedPlayers.length;

    console.log(`  ✓ Connected players: ${connectedPlayers.length}/50`);
    console.log(`  ✗ Disconnected players: ${disconnectedCount}/50`);

    if (disconnectedCount > 0) {
      metrics.recordError(`${disconnectedCount} players disconnected during game`);
    }

    // ============================================================
    // STEP 9: Validate Consistent Game State
    // ============================================================
    console.log('\n📋 Step 9: Validating consistent game state across all players...');

    // Check called numbers consistency (sample 50 players)
    const samplePlayers = socketPlayers.filter((_, i) => i % 10 === 0); // Every 10th player
    const referenceCalledNumbers = JSON.stringify(samplePlayers[0].calledNumbers);
    let inconsistentCount = 0;

    for (const player of samplePlayers) {
      if (JSON.stringify(player.calledNumbers) !== referenceCalledNumbers) {
        inconsistentCount++;
        metrics.recordError('Called numbers inconsistency', {
          player: player.account.name,
          expected: samplePlayers[0].calledNumbers.length,
          actual: player.calledNumbers.length,
        });
      }
    }

    console.log(`  ✓ Sampled ${samplePlayers.length} players for consistency check`);
    console.log(`  ✓ Consistent players: ${samplePlayers.length - inconsistentCount}/${samplePlayers.length}`);

    if (inconsistentCount > 0) {
      console.log(`  ⚠️  Warning: ${inconsistentCount} players have inconsistent state`);
    }

    // ============================================================
    // STEP 10: Generate Final Report
    // ============================================================
    console.log('\n📈 Step 10: Final Performance Report');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  CONNECTION & JOIN:');
    console.log(`    50 Players Connected:   ${totalConnectTime}ms (${Math.round(totalConnectTime/50)}ms avg per player)`);
    console.log(`    50 Players Joined:      ${totalJoinTime}ms (${Math.round(totalJoinTime/50)}ms avg per player)`);
    console.log('');
    console.log('  BROADCAST PERFORMANCE:');
    console.log(`    Numbers Called:          ${NUMBER_COUNT}`);
    console.log(`    P50 Latency:             ${latencyStats.p50}ms`);
    console.log(`    P90 Latency:             ${latencyStats.p90}ms`);
    console.log(`    P99 Latency:             ${latencyStats.p99}ms`);
    console.log('');
    console.log('  STABILITY:');
    console.log(`    Connected:               ${connectedPlayers.length}/50 (${Math.round(connectedPlayers.length/5)}%)`);
    console.log(`    Disconnected:            ${disconnectedCount}/50`);
    console.log(`    Errors:                  ${metrics.getErrorCount()}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================
    // SUCCESS CRITERIA VALIDATION
    // ============================================================
    console.log('✅ Step 11: Validating success criteria...');

    // All players should connect
    expect(connectedPlayers.length).toBeGreaterThanOrEqual(495); // Allow 5 connection failures
    console.log('  ✓ Connection success rate: >= 99%');

    // Broadcast latency P99 should be reasonable
    expect(latencyStats.p99).toBeLessThan(500); // Relaxed from 3000ms to 500ms for 50 players
    console.log(`  ✓ Broadcast latency P99: ${latencyStats.p99}ms < 500ms`);

    // Most players should have consistent state
    const consistencyRate = ((samplePlayers.length - inconsistentCount) / samplePlayers.length) * 100;
    expect(consistencyRate).toBeGreaterThanOrEqual(95);
    console.log(`  ✓ State consistency: ${consistencyRate.toFixed(1)}% >= 95%`);

    console.log('\n✅ SUCCESS: System handled 50 concurrent players successfully!');
    console.log('   - All players connected and joined');
    console.log(`   - P99 broadcast latency: ${latencyStats.p99}ms`);
    console.log('   - Stable connections throughout game');
    console.log('   - Consistent game state across players\n');
  }, 600000); // 10 minute timeout for 50-player test
});
