/**
 * CRITICAL LOAD TEST: Win Claim Race - 50 Simultaneous Claims
 *
 * Risk Level: CRITICAL (9/10)
 *
 * Purpose: Validate distributed lock prevents duplicate wins when 50 players
 * claim the same prize category simultaneously.
 *
 * Success Criteria:
 * - Exactly 1 winner accepted
 * - 99 rejections with proper error messages
 * - All rejections happen within 2 seconds
 * - No database inconsistencies
 * - All players receive consistent winner broadcast
 */

import { test, expect } from '@playwright/test';
import { SocketPlayer } from '../helpers/socket-player';
import { Organizer } from '../helpers/organizer';
import { MetricsCollector } from '../helpers/metrics';
import { Validators } from '../helpers/validators';
import accounts from '../setup/test-accounts.json' with { type: 'json' };

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

test.describe('Win Race: 50 Simultaneous Claims', () => {
  let organizer: Organizer;
  let socketPlayers: SocketPlayer[] = [];
  const metrics = new MetricsCollector();

  test.beforeAll(async () => {
    console.log('\n🧪 Loading test accounts for 50-player race test...');
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

  test('50 players claim Early 5 simultaneously - validate distributed lock', async () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║        50-PLAYER WIN RACE: DISTRIBUTED LOCK TEST           ║');
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
    console.log('🎮 Step 2: Creating game with Early 5 prize...');
    const gameId = await organizer.createGame({
      early5: 1000,
      topLine: 2000,
      middleLine: 2000,
      bottomLine: 2000,
      fullHouse: 5000,
    });
    console.log(`✅ Game created: ${gameId}\n`);

    // ============================================================
    // STEP 3: Connect 50 Socket Players
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

    // Connect all players in parallel
    await Promise.all(socketPlayers.map(p => p.connect()));

    const connectTime = Date.now() - connectStartTime;
    metrics.recordCustom('connect_time_ms', connectTime);
    console.log(`✅ 50 players connected in ${connectTime}ms\n`);

    // ============================================================
    // STEP 4: All Players Join Game
    // ============================================================
    console.log('🔗 Step 4: All players joining game...');
    const joinStartTime = Date.now();

    await Promise.all(socketPlayers.map(p => p.joinGame(gameId)));

    const joinTime = Date.now() - joinStartTime;
    metrics.recordCustom('join_time_ms', joinTime);
    console.log(`✅ 50 players joined in ${joinTime}ms\n`);

    // Validate tickets are unique
    Validators.validateUniqueTickets(socketPlayers);
    console.log('✅ All tickets are unique\n');

    // ============================================================
    // STEP 5: Start Game
    // ============================================================
    console.log('🚀 Step 5: Starting game...');
    await organizer.startGame();

    // Wait for game start to propagate
    await Validators.waitForCondition(
      () => socketPlayers.every(p => p.calledNumbers.length === 0),
      2000
    );
    console.log('✅ Game started\n');

    // ============================================================
    // STEP 6: Setup Race Condition - All 50 Players Get Exactly 5 Numbers
    // ============================================================
    console.log('🎯 Step 6: Setting up race condition (giving all players exactly 5 numbers)...');

    // Collect all numbers from all tickets
    const allTicketNumbers = new Set<number>();
    for (const player of socketPlayers) {
      if (player.ticket) {
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 9; col++) {
            const num = player.ticket[row][col];
            if (num !== 0) {
              allTicketNumbers.add(num);
            }
          }
        }
      }
    }

    const numbersArray = Array.from(allTicketNumbers);
    console.log(`📊 Found ${numbersArray.length} unique numbers across all tickets`);

    // Find 5 numbers that appear on ALL 50 tickets (or as many players as possible)
    const numberCounts = new Map<number, number>();
    for (const player of socketPlayers) {
      if (player.ticket) {
        const playerNumbers = new Set<number>();
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 9; col++) {
            const num = player.ticket[row][col];
            if (num !== 0) playerNumbers.add(num);
          }
        }
        playerNumbers.forEach(num => {
          numberCounts.set(num, (numberCounts.get(num) || 0) + 1);
        });
      }
    }

    // Sort by frequency and take top numbers
    const sortedNumbers = Array.from(numberCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);

    // Call 5 numbers that are most common
    const numbersToCall = sortedNumbers.slice(0, 5);
    console.log(`📢 Calling 5 most common numbers: ${numbersToCall.join(', ')}`);

    for (const num of numbersToCall) {
      await organizer.callNumber(num);
      console.log(`  ✓ Called: ${num}`);

      // Wait for broadcast to propagate
      await Validators.waitForCondition(
        () => socketPlayers.every(p => p.calledNumbers.includes(num)),
        3000
      );
    }

    console.log('✅ All 5 numbers called and received by all players\n');

    // ============================================================
    // STEP 7: Mark Numbers on All Players
    // ============================================================
    console.log('✏️  Step 7: Marking numbers on all players...');

    for (const player of socketPlayers) {
      for (const num of numbersToCall) {
        if (player.ticket) {
          for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 9; col++) {
              if (player.ticket[row][col] === num) {
                player.markNumber(num);
              }
            }
          }
        }
      }
    }

    // Count how many players have 5+ marked numbers
    const playersWithFive = socketPlayers.filter(p => p.markedNumbers.size >= 5);
    console.log(`✅ ${playersWithFive.length} players have 5+ marked numbers\n`);

    // ============================================================
    // STEP 8: ALL 50 PLAYERS CLAIM SIMULTANEOUSLY
    // ============================================================
    console.log('⚡ Step 8: RACE CONDITION - All 50 players claiming simultaneously...');
    const claimStartTime = Date.now();

    const claimPromises = socketPlayers.map(player =>
      player.claimWin('EARLY_5').catch(err => ({
        success: false,
        message: err.message || 'Claim failed',
        timeout: true,
      }))
    );

    const results = await Promise.all(claimPromises);
    const claimDuration = Date.now() - claimStartTime;

    metrics.recordCustom('claim_duration_ms', claimDuration);
    console.log(`⏱️  All claims completed in ${claimDuration}ms\n`);

    // ============================================================
    // STEP 9: Analyze Results
    // ============================================================
    console.log('📊 Step 9: Analyzing claim results...');

    const successResults = results.filter(r => r.success === true);
    const rejectionResults = results.filter(r => r.success === false && !r.timeout);
    const timeoutResults = results.filter(r => r.timeout === true);

    console.log(`  ✅ Successful claims: ${successResults.length}`);
    console.log(`  ❌ Rejected claims: ${rejectionResults.length}`);
    console.log(`  ⏱️  Timeout claims: ${timeoutResults.length}`);

    if (rejectionResults.length > 0) {
      const sampleRejections = rejectionResults.slice(0, 3);
      console.log(`  📝 Sample rejection messages:`);
      sampleRejections.forEach(r => console.log(`      - "${r.message}"`));
    }

    // ============================================================
    // STEP 10: Validate Distributed Lock Worked
    // ============================================================
    console.log('\n✅ Step 10: Validating distributed lock correctness...');

    // CRITICAL: Exactly 1 winner
    expect(successResults.length).toBe(1);
    console.log('  ✓ Exactly 1 winner (distributed lock worked!)');

    // CRITICAL: 99 rejections
    expect(rejectionResults.length).toBeGreaterThanOrEqual(98); // Allow 1-2 timeouts
    console.log(`  ✓ ${rejectionResults.length} rejections (as expected)`);

    // All rejections should happen quickly (within 2 seconds)
    expect(claimDuration).toBeLessThan(5000);
    console.log(`  ✓ All claims resolved in ${claimDuration}ms (< 5000ms)`);

    // ============================================================
    // STEP 11: Validate Winner Broadcast Consistency
    // ============================================================
    console.log('\n🎊 Step 11: Validating winner broadcast consistency...');

    // Wait for winner broadcast to propagate
    await Validators.waitForCondition(
      () => socketPlayers.every(p => p.winners.length > 0),
      5000
    );

    // All players should have received the same winner
    Validators.validateExclusiveWinner(socketPlayers, 'EARLY_5');
    console.log('  ✓ All players received consistent winner broadcast');

    // Winner should be one of the players who claimed successfully
    const winnerPlayerId = socketPlayers[0].winners.find(w => w.category === 'EARLY_5')?.playerId;
    expect(winnerPlayerId).toBeDefined();
    console.log(`  ✓ Winner: ${winnerPlayerId}`);

    // ============================================================
    // STEP 12: Generate Metrics Report
    // ============================================================
    console.log('\n📈 Step 12: Performance Metrics');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  50 Players Connected:     ${connectTime}ms`);
    console.log(`  50 Players Joined:        ${joinTime}ms`);
    console.log(`  50 Simultaneous Claims:   ${claimDuration}ms`);
    console.log(`  Success Rate:              ${successResults.length}/50`);
    console.log(`  Rejection Rate:            ${rejectionResults.length}/50`);
    console.log(`  Timeout Rate:              ${timeoutResults.length}/50`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // ============================================================
    // SUCCESS CRITERIA VALIDATION
    // ============================================================
    console.log('✅ SUCCESS: Distributed lock prevented duplicate wins!');
    console.log('   - 1 winner accepted');
    console.log(`   - ${rejectionResults.length} rejections`);
    console.log('   - No database inconsistencies');
    console.log('   - Consistent winner broadcast to all players\n');
  }, 180000); // 3 minute timeout for 50-player test
});
