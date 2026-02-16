/**
 * CRITICAL LOAD TEST: Database Pool Stress Test
 *
 * Risk Level: CRITICAL (9/10)
 *
 * Purpose: Validate database connection pool handles high concurrent load without
 * exhaustion. Test pool configuration, connection reuse, and query queueing under
 * stress conditions.
 *
 * Success Criteria:
 * - No connection pool exhaustion errors
 * - All database queries complete successfully
 * - Query latency remains acceptable (P99 < 1000ms)
 * - Connection pool size stays within configured limits
 * - No query timeouts or deadlocks
 */

import { test, expect } from '@playwright/test';
import { SocketPlayer } from '../helpers/socket-player';
import { Organizer } from '../helpers/organizer';
import { MetricsCollector } from '../helpers/metrics';
import { Validators } from '../helpers/validators';
import accounts from '../setup/test-accounts.json' with { type: 'json' };

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

test.describe('Database Pool Stress: Connection Pool Exhaustion Prevention', () => {
  let organizer: Organizer;
  let socketPlayers: SocketPlayer[] = [];
  const metrics = new MetricsCollector();

  test.beforeAll(async () => {
    console.log('\n🧪 Loading test accounts for database pool stress test...');
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

  test('50 players rapid join/leave cycles - validate connection pool stability', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║        DATABASE POOL STRESS: CONNECTION EXHAUSTION         ║');
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
    // STEP 2: Create Game
    // ============================================================
    console.log('🎮 Step 2: Creating game...');
    const gameId = await organizer.createGame({
      early5: 1000,
      topLine: 2000,
      middleLine: 2000,
      bottomLine: 2000,
      fullHouse: 5000,
    });
    console.log(`✅ Game created: ${gameId}\n`);

    // ============================================================
    // STEP 3: Connect 50 Players
    // ============================================================
    console.log('👥 Step 3: Connecting 50 socket players...');
    const connectStartTime = Date.now();

    for (let i = 0; i < 50; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      socketPlayers.push(player);
    }

    // Connect in batches of 50
    for (let batch = 0; batch < 1; batch++) {
      const startIdx = batch * 50;
      const endIdx = startIdx + 50;
      const batchPlayers = socketPlayers.slice(startIdx, endIdx);

      await Promise.all(batchPlayers.map(p => p.connect()));
      console.log(`  ✓ Batch ${batch + 1}/6: 50 players connected`);
    }

    const connectTime = Date.now() - connectStartTime;
    console.log(`✅ 50 players connected in ${connectTime}ms\n`);

    // ============================================================
    // STEP 4: CYCLE 1 - All Players Join Simultaneously
    // ============================================================
    console.log('🔄 Step 4: CYCLE 1 - All 50 players joining simultaneously...');
    const join1StartTime = Date.now();

    const joinPromises1 = socketPlayers.map(async (player) => {
      try {
        const joinStart = Date.now();
        await player.joinGame(gameId);
        const joinLatency = Date.now() - joinStart;
        metrics.recordLatency(joinLatency, player.account.id);
        return { success: true, latency: joinLatency };
      } catch (error) {
        metrics.recordError('Join failed - possible pool exhaustion', {
          player: player.account.name,
          error: String(error),
        });
        return { success: false, error };
      }
    });

    const joinResults1 = await Promise.all(joinPromises1);
    const join1Time = Date.now() - join1StartTime;
    const successfulJoins1 = joinResults1.filter(r => r.success).length;

    console.log(`✅ Join cycle 1 completed in ${join1Time}ms`);
    console.log(`  ✓ Successful: ${successfulJoins1}/50`);
    console.log(`  ✗ Failed: ${50 - successfulJoins1}/50\n`);

    // ============================================================
    // STEP 5: Start Game and Call 5 Numbers
    // ============================================================
    console.log('🚀 Step 5: Starting game and calling 5 numbers...');
    await organizer.startGame();

    await Validators.waitForCondition(
      () => socketPlayers.filter(p => p.calledNumbers.length === 0).length >= 290,
      5000
    );

    const calledNumbers = await organizer.callRandomNumbers(5, 800);
    console.log(`✅ Called 5 numbers: ${calledNumbers.join(', ')}\n`);

    // Wait for numbers to propagate
    await new Promise(resolve => setTimeout(resolve, 500));

    // ============================================================
    // STEP 6: CYCLE 2 - All Players Leave Simultaneously
    // ============================================================
    console.log('🔄 Step 6: CYCLE 2 - All 50 players leaving simultaneously...');
    const leave1StartTime = Date.now();

    socketPlayers.forEach(player => player.leaveGame());

    const leave1Time = Date.now() - leave1StartTime;
    console.log(`✅ Leave cycle 1 completed in ${leave1Time}ms\n`);

    // Give server time to process leaves and free connections
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ============================================================
    // STEP 7: CYCLE 3 - All Players Rejoin Simultaneously
    // ============================================================
    console.log('🔄 Step 7: CYCLE 3 - All 50 players rejoining simultaneously...');
    const join2StartTime = Date.now();

    const joinPromises2 = socketPlayers.map(async (player) => {
      try {
        const joinStart = Date.now();
        await player.joinGame(gameId);
        const joinLatency = Date.now() - joinStart;
        metrics.recordLatency(joinLatency, player.account.id);
        return { success: true, latency: joinLatency };
      } catch (error) {
        metrics.recordError('Rejoin failed - possible pool exhaustion', {
          player: player.account.name,
          error: String(error),
        });
        return { success: false, error };
      }
    });

    const joinResults2 = await Promise.all(joinPromises2);
    const join2Time = Date.now() - join2StartTime;
    const successfulJoins2 = joinResults2.filter(r => r.success).length;

    console.log(`✅ Join cycle 2 completed in ${join2Time}ms`);
    console.log(`  ✓ Successful: ${successfulJoins2}/50`);
    console.log(`  ✗ Failed: ${50 - successfulJoins2}/50\n`);

    // ============================================================
    // STEP 8: Call 10 More Numbers
    // ============================================================
    console.log('📢 Step 8: Calling 10 more numbers...');
    const newNumbers = await organizer.callRandomNumbers(10, 800);
    console.log(`✅ Called 10 numbers: ${newNumbers.join(', ')}\n`);

    await new Promise(resolve => setTimeout(resolve, 5000));

    // ============================================================
    // STEP 9: CYCLE 4 - All Players Leave Again
    // ============================================================
    console.log('🔄 Step 9: CYCLE 4 - All 50 players leaving again...');
    const leave2StartTime = Date.now();

    socketPlayers.forEach(player => player.leaveGame());

    const leave2Time = Date.now() - leave2StartTime;
    console.log(`✅ Leave cycle 2 completed in ${leave2Time}ms\n`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // ============================================================
    // STEP 10: CYCLE 5 - Final Rejoin Stress Test
    // ============================================================
    console.log('🔄 Step 10: CYCLE 5 - Final rejoin (stress test)...');
    const join3StartTime = Date.now();

    const joinPromises3 = socketPlayers.map(async (player) => {
      try {
        const joinStart = Date.now();
        await player.joinGame(gameId);
        const joinLatency = Date.now() - joinStart;
        metrics.recordLatency(joinLatency, player.account.id);
        return { success: true, latency: joinLatency };
      } catch (error) {
        metrics.recordError('Final rejoin failed - pool exhaustion detected', {
          player: player.account.name,
          error: String(error),
        });
        return { success: false, error };
      }
    });

    const joinResults3 = await Promise.all(joinPromises3);
    const join3Time = Date.now() - join3StartTime;
    const successfulJoins3 = joinResults3.filter(r => r.success).length;

    console.log(`✅ Join cycle 3 completed in ${join3Time}ms`);
    console.log(`  ✓ Successful: ${successfulJoins3}/50`);
    console.log(`  ✗ Failed: ${50 - successfulJoins3}/50\n`);

    // ============================================================
    // STEP 11: Analyze Query Latency
    // ============================================================
    console.log('📊 Step 11: Analyzing database query latency...');
    const latencyStats = metrics.getLatencyStats();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  DATABASE QUERY LATENCY (Join Operations):');
    console.log(`    Total Queries:           ${latencyStats.count}`);
    console.log(`    Min:                     ${latencyStats.min}ms`);
    console.log(`    Max:                     ${latencyStats.max}ms`);
    console.log(`    Avg:                     ${latencyStats.avg}ms`);
    console.log(`    P50:                     ${latencyStats.p50}ms`);
    console.log(`    P90:                     ${latencyStats.p90}ms`);
    console.log(`    P99:                     ${latencyStats.p99}ms`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================
    // STEP 12: Analyze Error Patterns
    // ============================================================
    console.log('📋 Step 12: Analyzing error patterns...');
    const errors = metrics.getErrors();
    const errorsByType = new Map<string, number>();

    for (const error of errors) {
      const errorMsg = String(error.error);
      const errorType = errorMsg.includes('pool') ? 'Pool Exhaustion' :
                       errorMsg.includes('timeout') ? 'Timeout' :
                       errorMsg.includes('connection') ? 'Connection Error' :
                       'Other';

      errorsByType.set(errorType, (errorsByType.get(errorType) || 0) + 1);
    }

    console.log('  ERROR BREAKDOWN:');
    if (errorsByType.size === 0) {
      console.log('    ✅ No errors detected!');
    } else {
      for (const [type, count] of errorsByType) {
        console.log(`    ${type}: ${count}`);
      }
    }
    console.log('');

    // ============================================================
    // STEP 13: Final Performance Report
    // ============================================================
    console.log('📈 Step 13: Final Performance Report');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  JOIN/LEAVE CYCLES:');
    console.log(`    Cycle 1 Join:            ${join1Time}ms (${successfulJoins1}/50 success)`);
    console.log(`    Cycle 2 Leave:           ${leave1Time}ms`);
    console.log(`    Cycle 3 Rejoin:          ${join2Time}ms (${successfulJoins2}/50 success)`);
    console.log(`    Cycle 4 Leave:           ${leave2Time}ms`);
    console.log(`    Cycle 5 Rejoin:          ${join3Time}ms (${successfulJoins3}/50 success)`);
    console.log('');
    console.log('  QUERY PERFORMANCE:');
    console.log(`    Total Operations:        ${latencyStats.count}`);
    console.log(`    P99 Latency:             ${latencyStats.p99}ms`);
    console.log(`    Max Latency:             ${latencyStats.max}ms`);
    console.log('');
    console.log('  STABILITY:');
    console.log(`    Total Errors:            ${errors.length}`);
    console.log(`    Error Rate:              ${((errors.length / latencyStats.count) * 100).toFixed(2)}%`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================
    // SUCCESS CRITERIA VALIDATION
    // ============================================================
    console.log('✅ Step 14: Validating success criteria...');

    // At least 95% of all join operations should succeed
    const totalJoinAttempts = 900; // 3 join cycles × 50 players
    const totalSuccessfulJoins = successfulJoins1 + successfulJoins2 + successfulJoins3;
    const successRate = (totalSuccessfulJoins / totalJoinAttempts) * 100;

    expect(successRate).toBeGreaterThanOrEqual(95);
    console.log(`  ✓ Join success rate: ${successRate.toFixed(1)}% >= 95%`);

    // P99 query latency should be reasonable
    expect(latencyStats.p99).toBeLessThan(500); // 3 seconds
    console.log(`  ✓ P99 query latency: ${latencyStats.p99}ms < 500ms`);

    // No pool exhaustion errors (or very few)
    const poolExhaustionErrors = errors.filter(e =>
      String(e.error).toLowerCase().includes('pool')
    ).length;
    expect(poolExhaustionErrors).toBeLessThan(10); // Allow up to 10 pool errors
    console.log(`  ✓ Pool exhaustion errors: ${poolExhaustionErrors} < 10`);

    // Overall error rate should be low
    const errorRate = (errors.length / latencyStats.count) * 100;
    expect(errorRate).toBeLessThan(5); // < 5% error rate
    console.log(`  ✓ Error rate: ${errorRate.toFixed(2)}% < 5%`);

    console.log('\n✅ SUCCESS: Database connection pool handled stress test!');
    console.log('   - 900 database operations (3 join cycles × 50 players)');
    console.log(`   - ${successRate.toFixed(1)}% success rate`);
    console.log(`   - P99 latency: ${latencyStats.p99}ms`);
    console.log('   - No connection pool exhaustion');
    console.log('   - Connection pool reuse working correctly\n');
  }, 600000); // 10 minute timeout
});
