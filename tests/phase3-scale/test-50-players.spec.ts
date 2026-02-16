/**
 * Quick Test: 50 Players to verify lobby flow
 */

import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SocketPlayer } from './helpers/socket-player';
import { Organizer } from './helpers/organizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.BACKEND_URL || 'https://api.tambola.me';

test('50 players full flow', async () => {
  const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'setup/test-accounts.json'), 'utf-8'));

  console.log('\n🧪 Testing 50 Player Game Flow\n');

  // Setup organizer
  const organizer = new Organizer({
    account: accounts.organizers[0],
    backendUrl: BACKEND_URL,
    debug: false,
  });

  await organizer.connect();
  const gameId = await organizer.createGame();
  console.log(`✅ Game created: ${gameId}\n`);

  // Connect 50 players
  const socketPlayers: SocketPlayer[] = [];
  console.log('Connecting 50 players...');
  for (let i = 0; i < 50; i++) {
    const player = new SocketPlayer({
      account: accounts.players[i],
      backendUrl: BACKEND_URL,
      debug: false,
    });
    await player.connect();
    socketPlayers.push(player);
    if ((i + 1) % 10 === 0) console.log(`  Connected: ${i + 1}/50`);
  }
  console.log('✅ All 50 players connected\n');

  // Join lobby (staggered)
  console.log('Players joining lobby...');
  const lobbyJoinPromises = socketPlayers.map((player, index) => {
    const delay = Math.floor((index / 50) * 10000); // Spread over 10 seconds
    return new Promise<void>(async (resolve) => {
      setTimeout(async () => {
        await player.joinLobby(gameId);
        resolve();
      }, delay);
    });
  });
  await Promise.all(lobbyJoinPromises);
  console.log('✅ All 50 players joined lobby\n');

  // Players start listening for game:starting BEFORE organizer starts
  console.log('Players setting up game:starting listeners...');
  const gameJoinPromises = socketPlayers.map(async (player) => {
    await player.waitForGameStart();
    await player.joinGame(gameId);
  });

  // Small delay to ensure listeners are set up
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Now organizer starts game
  console.log('Organizer starting game...');
  await organizer.startGame();
  console.log('✅ Game started\n');

  // Wait for all players to join
  console.log('Players joining active game...');
  await Promise.all(gameJoinPromises);
  console.log('✅ All 50 players in active game\n');

  // Call 10 numbers
  console.log('Calling 10 numbers...');
  await organizer.callRandomNumbers(10, 500);
  console.log('✅ Called 10 numbers\n');

  // Cleanup
  socketPlayers.forEach(p => p.disconnect());
  await organizer.cleanup();
  console.log('✅ TEST PASSED!\n');
});
