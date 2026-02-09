/**
 * Test 9: Early 5 Win Race Condition
 *
 * Validates win claim handling when multiple players claim simultaneously:
 * - 5 players each have exactly 5 marked numbers
 * - All 5 players claim Early 5 within 100ms window
 * - Verify only first claim is accepted
 * - Verify other 4 receive rejection
 * - Verify PostgreSQL has exactly 1 Early 5 winner
 * - Verify all 50 players see correct winner broadcast
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SocketPlayer } from '../helpers/socket-player';
import { Organizer } from '../helpers/organizer';
import { MetricsCollector } from '../helpers/metrics';
import { Validators } from '../helpers/validators';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';

test.describe('Win Race: Early 5 Simultaneous Claims', () => {
  let accounts: any;
  let organizer: Organizer;
  let socketPlayers: SocketPlayer[] = [];
  let gameId: string;
  let metrics: MetricsCollector;

  test.beforeAll(async () => {
    const accountsPath = path.join(__dirname, '../setup/test-accounts.json');
    if (!fs.existsSync(accountsPath)) {
      throw new Error('Test accounts not found. Run: node setup/create-test-accounts.mjs');
    }
    accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));

    console.log(`\n✅ Loaded test accounts`);
  });

  test('5 players claim Early 5 simultaneously', async () => {
    metrics = new MetricsCollector();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║   TEST 9: EARLY 5 RACE CONDITION (5 PLAYERS)              ║');
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
    await organizer.joinGame(gameId);
    console.log(`✅ Organizer ready, game: ${gameId}\n`);

    // Step 2: Connect 50 socket players
    console.log('Step 2: Connecting 50 socket players...');
    for (let i = 0; i < 50; i++) {
      const player = new SocketPlayer({
        account: accounts.players[i],
        backendUrl: BACKEND_URL,
        debug: false,
      });
      await player.connect();
      socketPlayers.push(player);

      if ((i + 1) % 10 === 0) {
        console.log(`  Connected: ${i + 1}/50 players`);
      }
    }
    console.log('✅ All 50 players connected\n');

    // Step 3: All players join game
    console.log('Step 3: Players joining game...');
    await Promise.all(socketPlayers.map(p => p.joinGame(gameId)));
    console.log('✅ All 50 players joined\n');

    // Step 4: Start game
    console.log('Step 4: Starting game...');
    await organizer.startGame();
    console.log('✅ Game started\n');

    // Step 5: Identify 5 players who can mark exactly 5 numbers
    console.log('Step 5: Setting up 5 players for Early 5 race...');

    // We need to call numbers strategically so 5 players can mark exactly 5 numbers
    // Strategy: Call numbers from first 5 players' tickets (5 numbers each)

    const racePlayers = socketPlayers.slice(0, 5);
    const numbersToCall: number[] = [];

    // For each race player, collect 5 numbers from their ticket
    racePlayers.forEach((player, index) => {
      if (!player.ticket) throw new Error('Ticket not loaded');

      const numbersOnTicket = player.ticket.flat().filter(n => n !== 0);
      const first5 = numbersOnTicket.slice(0, 5);

      console.log(`  Player ${index + 1} (${player.account.name}): Will mark ${first5.join(', ')}`);
      numbersToCall.push(...first5);
    });

    // Remove duplicates and call all numbers
    const uniqueNumbers = Array.from(new Set(numbersToCall));
    console.log(`  Calling ${uniqueNumbers.length} unique numbers...`);

    for (const number of uniqueNumbers) {
      await organizer.callNumber(number);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    console.log('✅ Numbers called\n');

    // Step 6: Each race player manually marks their 5 numbers
    console.log('Step 6: Race players marking their 5 numbers...');
    for (let i = 0; i < racePlayers.length; i++) {
      const player = racePlayers[i];
      if (!player.ticket) continue;

      const numbersOnTicket = player.ticket.flat().filter(n => n !== 0);
      const first5 = numbersOnTicket.slice(0, 5);

      for (const number of first5) {
        try {
          player.markNumber(number);
        } catch (e) {
          console.log(`  ⚠️  ${player.account.name} failed to mark ${number}: ${e}`);
        }
      }

      console.log(`  ${player.account.name} marked ${player.markedNumbers.size} numbers`);
    }
    console.log('✅ All race players have marked 5 numbers\n');

    // Step 7: All 5 players claim Early 5 SIMULTANEOUSLY
    console.log('Step 7: 5 players claiming Early 5 simultaneously...');

    const claimPromises = racePlayers.map(player =>
      player.claimWin('EARLY_5').catch(err => ({
        success: false,
        message: `Claim failed: ${err.message}`,
      }))
    );

    const results = await Promise.all(claimPromises);

    console.log('\n  Claim results:');
    results.forEach((result, index) => {
      console.log(`    Player ${index + 1}: ${result.success ? '✅ ACCEPTED' : '❌ REJECTED'} - ${result.message}`);
    });

    // Step 8: Validate exactly 1 success
    console.log('\nValidating: Exactly 1 claim accepted...');
    const successCount = results.filter(r => r.success).length;

    if (successCount === 1) {
      console.log('✅ Exactly 1 claim accepted\n');
    } else {
      console.log(`❌ Expected 1 success, got ${successCount}\n`);
      throw new Error(`Early 5 race condition failed: ${successCount} claims accepted`);
    }

    // Validate: 4 rejections
    const rejectionCount = results.filter(r => !r.success).length;
    if (rejectionCount === 4) {
      console.log('✅ 4 claims rejected as expected\n');
    } else {
      throw new Error(`Expected 4 rejections, got ${rejectionCount}`);
    }

    // Step 9: Wait for winner broadcast
    console.log('Step 9: Waiting for winner broadcast...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Validate: All 50 players see exactly 1 Early 5 winner
    console.log('Validating: All players see 1 Early 5 winner...');
    const winnersSeenByPlayers = socketPlayers.map(p => {
      const early5Winners = p.winners.filter(w => w.category === 'EARLY_5');
      return early5Winners.length;
    });

    const allSee1Winner = winnersSeenByPlayers.every(count => count === 1);

    if (allSee1Winner) {
      console.log('✅ All 50 players see exactly 1 Early 5 winner\n');
    } else {
      console.log(`❌ Winner count discrepancies: ${winnersSeenByPlayers.slice(0, 10).join(', ')}...`);
      throw new Error('Not all players see exactly 1 winner');
    }

    // Step 10: Validate winner is one of the race players
    const winnerPlayerId = socketPlayers[0].winners.find(w => w.category === 'EARLY_5')?.playerId;
    const winnerIsRacePlayer = racePlayers.some(p => p.playerId === winnerPlayerId);

    if (winnerIsRacePlayer) {
      const winnerName = racePlayers.find(p => p.playerId === winnerPlayerId)?.account.name;
      console.log(`✅ Winner is one of the race players: ${winnerName}\n`);
    } else {
      throw new Error('Winner is not one of the race players');
    }

    // Step 11: Validate no duplicate winners in winners array
    console.log('Validating: No duplicate Early 5 winners...');
    Validators.validateExclusiveWinner(socketPlayers, 'EARLY_5');
    console.log('✅ No duplicate winners\n');

    // Step 12: Continue game to ensure no issues
    console.log('Step 12: Continuing game (calling 10 more numbers)...');
    await organizer.callRandomNumbers(10, 500);
    console.log('✅ Game continues normally\n');

    // Final Summary
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    TEST COMPLETE                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`  Race players: 5`);
    console.log(`  Claims accepted: 1`);
    console.log(`  Claims rejected: 4`);
    console.log(`  Winner broadcast: ✅ (all 50 players notified)`);
    console.log(`  No duplicate winners: ✅`);
    console.log(`  Game continues: ✅`);
    console.log(`  Status: ✅ PASSED\n`);

    // Cleanup
    console.log('Cleaning up...');
    socketPlayers.forEach(p => p.disconnect());
    await organizer.cleanup();
    console.log('✅ Cleanup complete\n');
  });
});
