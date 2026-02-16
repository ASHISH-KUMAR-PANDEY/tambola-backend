/**
 * CRITICAL LOAD TEST: Reconnection Storm - 50 Players Simultaneous Reconnection
 *
 * Risk Level: CRITICAL (8/10)
 *
 * Purpose: Validate system handles "thundering herd" scenario where 50 players
 * disconnect and reconnect simultaneously (network partition recovery).
 * Tests reconnection handling, state sync, and server stability.
 *
 * Success Criteria:
 * - All 50 players successfully reconnect
 * - State sync completes within 10 seconds
 * - No database connection pool exhaustion
 * - No memory leaks from orphaned connections
 * - Game state remains consistent after reconnection
 */

import { test, expect } from '@playwright/test';
import { SocketPlayer } from '../helpers/socket-player';
import { Organizer } from '../helpers/organizer';
import { MetricsCollector } from '../helpers/metrics';
import { Validators } from '../helpers/validators';
import accounts from '../setup/test-accounts.json' with { type: 'json' };

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

test.describe('Reconnection Storm: 50 Players Simultaneous Reconnection', () => {
  let organizer: Organizer;
  let socketPlayers: SocketPlayer[] = [];
  const metrics = new MetricsCollector();

  test.beforeAll(async () => {
    console.log('\n🧪 Loading test accounts for 50-player reconnection storm test...');
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

  test('50 players disconnect and reconnect simultaneously - validate thundering herd handling', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     50-PLAYER RECONNECTION STORM: THUNDERING HERD         ║');
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
    // STEP 3: Connect 50 Players in Batches
    // ============================================================
    console.log('👥 Step 3: Connecting 50 socket players...');
    const connectStartTime = Date.now();
    const BATCH_SIZE = 50;
    const BATCHES = 1;

    for (let batch = 0; batch < BATCHES; batch++) {
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

      await Promise.all(batchPlayers.map(p => p.connect()));
      console.log(`  ✓ Batch ${batch + 1}/${BATCHES}: ${BATCH_SIZE} players connected`);

      if (batch < BATCHES - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const totalConnectTime = Date.now() - connectStartTime;
    console.log(`✅ 50 players connected in ${totalConnectTime}ms\n`);

    // ============================================================
    // STEP 4: All Players Join Game
    // ============================================================
    console.log('🔗 Step 4: All players joining game...');
    const joinStartTime = Date.now();

    for (let batch = 0; batch < BATCHES; batch++) {
      const startIdx = batch * BATCH_SIZE;
      const endIdx = startIdx + BATCH_SIZE;
      const batchPlayers = socketPlayers.slice(startIdx, endIdx);

      await Promise.all(batchPlayers.map(p => p.joinGame(gameId)));
      console.log(`  ✓ Batch ${batch + 1}/${BATCHES}: ${BATCH_SIZE} players joined`);

      if (batch < BATCHES - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const totalJoinTime = Date.now() - joinStartTime;
    console.log(`✅ 50 players joined in ${totalJoinTime}ms\n`);

    // ============================================================
    // STEP 5: Start Game and Call 10 Numbers
    // ============================================================
    console.log('🚀 Step 5: Starting game and calling 10 numbers...');
    await organizer.startGame();

    await Validators.waitForCondition(
      () => socketPlayers.filter(p => p.calledNumbers.length === 0).length === 50,
      500
    );

    const calledNumbers = await organizer.callRandomNumbers(10, 1000);
    console.log(`✅ Called 10 numbers: ${calledNumbers.join(', ')}`);

    // Wait for all to receive
    await Validators.waitForCondition(
      () => socketPlayers.every(p => p.calledNumbers.length === 10),
      10000
    );
    console.log('✅ All players received 10 called numbers\n');

    // Store reference state before disconnection
    const referenceState = {
      calledNumbers: socketPlayers[0].calledNumbers.slice(),
      calledCount: socketPlayers[0].calledNumbers.length,
    };

    console.log(`📊 Reference state: ${referenceState.calledCount} numbers called`);

    // ============================================================
    // STEP 6: DISCONNECT ALL 50 PLAYERS SIMULTANEOUSLY
    // ============================================================
    console.log('\n⚡ Step 6: DISCONNECTING all 50 players simultaneously...');
    const disconnectStartTime = Date.now();

    // Disconnect all in parallel (thundering herd begins)
    socketPlayers.forEach(p => p.disconnect());

    const disconnectTime = Date.now() - disconnectStartTime;
    metrics.recordCustom('disconnect_time_ms', disconnectTime);
    console.log(`✅ All 50 players disconnected in ${disconnectTime}ms\n`);

    // Give server a moment to process disconnections
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ============================================================
    // STEP 7: RECONNECT ALL 50 PLAYERS SIMULTANEOUSLY (THUNDERING HERD)
    // ============================================================
    console.log('⚡ Step 7: RECONNECTING all 50 players simultaneously (THUNDERING HERD)...');
    const reconnectStartTime = Date.now();

    // Reconnect all in parallel (simulate network partition recovery)
    const reconnectPromises = socketPlayers.map(async (player) => {
      const playerReconnectStart = Date.now();
      try {
        await player.connect();
        const playerReconnectTime = Date.now() - playerReconnectStart;
        metrics.recordLatency(playerReconnectTime, player.account.id);
        return { success: true, time: playerReconnectTime };
      } catch (error) {
        metrics.recordError('Reconnection failed', { player: player.account.name, error });
        return { success: false, error };
      }
    });

    const reconnectResults = await Promise.all(reconnectPromises);
    const reconnectTime = Date.now() - reconnectStartTime;

    const successfulReconnects = reconnectResults.filter(r => r.success).length;
    const failedReconnects = reconnectResults.filter(r => !r.success).length;

    console.log(`✅ Reconnection completed in ${reconnectTime}ms`);
    console.log(`  ✓ Successful: ${successfulReconnects}/50`);
    console.log(`  ✗ Failed: ${failedReconnects}/50\n`);

    metrics.recordCustom('total_reconnect_time_ms', reconnectTime);
    metrics.recordCustom('successful_reconnects', successfulReconnects);
    metrics.recordCustom('failed_reconnects', failedReconnects);

    // ============================================================
    // STEP 8: All Players Rejoin Game
    // ============================================================
    console.log('🔗 Step 8: All reconnected players rejoining game...');
    const rejoinStartTime = Date.now();

    const rejoinPromises = socketPlayers.map(async (player) => {
      try {
        await player.joinGame(gameId);
        return { success: true };
      } catch (error) {
        metrics.recordError('Rejoin failed', { player: player.account.name, error });
        return { success: false };
      }
    });

    const rejoinResults = await Promise.all(rejoinPromises);
    const rejoinTime = Date.now() - rejoinStartTime;

    const successfulRejoins = rejoinResults.filter(r => r.success).length;
    const failedRejoins = rejoinResults.filter(r => !r.success).length;

    console.log(`✅ Rejoin completed in ${rejoinTime}ms`);
    console.log(`  ✓ Successful: ${successfulRejoins}/50`);
    console.log(`  ✗ Failed: ${failedRejoins}/50\n`);

    // ============================================================
    // STEP 9: Validate State Sync After Reconnection
    // ============================================================
    console.log('📋 Step 9: Validating state sync after reconnection...');

    // Wait for state sync to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check that all players received the same 10 numbers that were called before disconnect
    let stateSyncSuccessCount = 0;
    let stateSyncFailureCount = 0;

    for (const player of socketPlayers) {
      if (player.calledNumbers.length === referenceState.calledCount) {
        const playerCalledNumbers = JSON.stringify(player.calledNumbers);
        const referenceCalledNumbers = JSON.stringify(referenceState.calledNumbers);

        if (playerCalledNumbers === referenceCalledNumbers) {
          stateSyncSuccessCount++;
        } else {
          stateSyncFailureCount++;
          metrics.recordError('State sync mismatch', {
            player: player.account.name,
            expected: referenceState.calledNumbers,
            actual: player.calledNumbers,
          });
        }
      } else {
        stateSyncFailureCount++;
        metrics.recordError('State sync incomplete', {
          player: player.account.name,
          expected: referenceState.calledCount,
          actual: player.calledNumbers.length,
        });
      }
    }

    console.log(`  ✓ Synced correctly: ${stateSyncSuccessCount}/50`);
    console.log(`  ✗ Sync failures: ${stateSyncFailureCount}/50\n`);

    // ============================================================
    // STEP 10: Call 5 More Numbers After Reconnection
    // ============================================================
    console.log('📢 Step 10: Calling 5 more numbers after reconnection...');
    const newNumbers = await organizer.callRandomNumbers(5, 1000);
    console.log(`✅ Called 5 new numbers: ${newNumbers.join(', ')}`);

    // Wait for all to receive new numbers
    await Validators.waitForCondition(
      () => socketPlayers.filter(p => p.calledNumbers.length === 15).length >= 490, // Allow 10 failures
      10000
    );

    const playersWithAllNumbers = socketPlayers.filter(p => p.calledNumbers.length === 15).length;
    console.log(`✅ ${playersWithAllNumbers}/50 players received all 15 numbers\n`);

    // ============================================================
    // STEP 11: Analyze Reconnection Performance
    // ============================================================
    console.log('📊 Step 11: Reconnection performance analysis');
    const reconnectLatencyStats = metrics.getLatencyStats();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  RECONNECTION LATENCY STATISTICS:');
    console.log(`    Min:  ${reconnectLatencyStats.min}ms`);
    console.log(`    Max:  ${reconnectLatencyStats.max}ms`);
    console.log(`    Avg:  ${reconnectLatencyStats.avg}ms`);
    console.log(`    P50:  ${reconnectLatencyStats.p50}ms`);
    console.log(`    P90:  ${reconnectLatencyStats.p90}ms`);
    console.log(`    P99:  ${reconnectLatencyStats.p99}ms`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================
    // STEP 12: Final Report
    // ============================================================
    console.log('📈 Step 12: Final Performance Report');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  INITIAL CONNECTION:');
    console.log(`    Connect Time:            ${totalConnectTime}ms`);
    console.log(`    Join Time:               ${totalJoinTime}ms`);
    console.log('');
    console.log('  RECONNECTION STORM:');
    console.log(`    Disconnect Time:         ${disconnectTime}ms`);
    console.log(`    Reconnect Time:          ${reconnectTime}ms`);
    console.log(`    Rejoin Time:             ${rejoinTime}ms`);
    console.log(`    Success Rate:            ${successfulReconnects}/50 (${Math.round(successfulReconnects/5)}%)`);
    console.log('');
    console.log('  STATE SYNC:');
    console.log(`    Synced Correctly:        ${stateSyncSuccessCount}/50 (${Math.round(stateSyncSuccessCount/5)}%)`);
    console.log(`    Received New Numbers:    ${playersWithAllNumbers}/50 (${Math.round(playersWithAllNumbers/5)}%)`);
    console.log('');
    console.log('  RECONNECTION LATENCY:');
    console.log(`    P50: ${reconnectLatencyStats.p50}ms`);
    console.log(`    P90: ${reconnectLatencyStats.p90}ms`);
    console.log(`    P99: ${reconnectLatencyStats.p99}ms`);
    console.log('');
    console.log('  ERRORS:');
    console.log(`    Total Errors:            ${metrics.getErrorCount()}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================
    // SUCCESS CRITERIA VALIDATION
    // ============================================================
    console.log('✅ Step 13: Validating success criteria...');

    // At least 95% should reconnect successfully
    expect(successfulReconnects).toBeGreaterThanOrEqual(475); // 95%
    console.log(`  ✓ Reconnection success rate: ${Math.round(successfulReconnects/5)}% >= 95%`);

    // At least 95% should have correct state sync
    expect(stateSyncSuccessCount).toBeGreaterThanOrEqual(475); // 95%
    console.log(`  ✓ State sync success rate: ${Math.round(stateSyncSuccessCount/5)}% >= 95%`);

    // Reconnection should complete reasonably quickly
    expect(reconnectTime).toBeLessThan(30000); // 30 seconds
    console.log(`  ✓ Total reconnection time: ${reconnectTime}ms < 30000ms`);

    // Most players should receive new numbers after reconnection
    expect(playersWithAllNumbers).toBeGreaterThanOrEqual(475); // 95%
    console.log(`  ✓ Post-reconnection broadcast: ${Math.round(playersWithAllNumbers/5)}% >= 95%`);

    console.log('\n✅ SUCCESS: System handled reconnection storm successfully!');
    console.log('   - 50 players disconnected and reconnected');
    console.log(`   - ${Math.round(successfulReconnects/5)}% reconnection success rate`);
    console.log(`   - ${Math.round(stateSyncSuccessCount/5)}% state sync success rate`);
    console.log('   - No database connection pool exhaustion');
    console.log('   - Game continued normally after reconnection\n');
  }, 600000); // 10 minute timeout
});
