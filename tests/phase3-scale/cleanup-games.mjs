#!/usr/bin/env node

/**
 * Clean Up Test Games
 * Deletes all games created by test organizer accounts
 */

import accounts from './setup/test-accounts.json' with { type: 'json' };

const BACKEND_URL = 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';
const ORGANIZER_TOKEN = accounts.organizers[0].token;
const ORGANIZER_ID = accounts.organizers[0].id;

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║             CLEAN UP TEST GAMES                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

async function getAllGames() {
  const response = await fetch(`${BACKEND_URL}/api/v1/games`, {
    headers: {
      'Authorization': `Bearer ${ORGANIZER_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch games: ${response.status}`);
  }

  const data = await response.json();
  return data.games;
}

async function deleteGame(gameId) {
  const response = await fetch(`${BACKEND_URL}/api/v1/games/${gameId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${ORGANIZER_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete game ${gameId}: ${response.status}`);
  }

  // Check if response has content
  const text = await response.text();
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { success: true, message: text };
    }
  }

  // No content - success (204 No Content)
  return { success: true };
}

async function cleanupGames() {
  try {
    // Get all games
    console.log('📋 Fetching all games...\n');
    const allGames = await getAllGames();
    console.log(`Found ${allGames.length} total games\n`);

    // Filter games created by test organizer
    const testGames = allGames.filter(game => game.createdBy === ORGANIZER_ID);
    console.log(`Found ${testGames.length} games created by test organizer\n`);

    if (testGames.length === 0) {
      console.log('✅ No test games to delete\n');
      return;
    }

    // Show games to be deleted
    console.log('Games to be deleted:');
    console.log('═'.repeat(60));
    for (const game of testGames) {
      console.log(`  ID: ${game.id}`);
      console.log(`  Status: ${game.status}`);
      console.log(`  Players: ${game.playerCount}`);
      console.log(`  Created: ${game.scheduledTime}`);
      console.log('─'.repeat(60));
    }

    console.log('\n🗑️  Deleting test games...\n');

    let deleted = 0;
    let failed = 0;

    for (const game of testGames) {
      try {
        await deleteGame(game.id);
        deleted++;
        console.log(`  ✅ Deleted: ${game.id} (${game.status})`);
      } catch (error) {
        failed++;
        console.error(`  ❌ Failed: ${game.id} - ${error.message}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`✅ Deleted: ${deleted} games`);
    if (failed > 0) {
      console.log(`❌ Failed: ${failed} games`);
    }
    console.log('═══════════════════════════════════════════════════════════\n');

    // Verify cleanup
    console.log('🔍 Verifying cleanup...\n');
    const remainingGames = await getAllGames();
    const remainingTestGames = remainingGames.filter(game => game.createdBy === ORGANIZER_ID);

    if (remainingTestGames.length === 0) {
      console.log('✅ All test games successfully deleted\n');
    } else {
      console.log(`⚠️  ${remainingTestGames.length} test games still remain\n`);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

cleanupGames().catch(console.error);
