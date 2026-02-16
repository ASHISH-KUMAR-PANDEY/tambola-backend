#!/usr/bin/env node
/**
 * Delete all test games from production RDS database
 */

import { PrismaClient } from '@prisma/client';

// Production RDS connection
const DATABASE_URL = 'postgresql://tambolaadmin:TambolaDB2024Secure!@tambola-postgres-prod.c292s6es6tia.us-east-1.rds.amazonaws.com:5432/tambola_db';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function cleanupProductionGames() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   CLEANUP: Delete ALL Test Games from Production DB       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Count current games
    console.log('Step 1: Counting games...');
    const gameCount = await prisma.game.count();
    console.log(`  Total games in database: ${gameCount}\n`);

    if (gameCount === 0) {
      console.log('✅ No games to delete\n');
      return;
    }

    // Step 2: Get all games with details
    console.log('Step 2: Fetching game details...');
    const games = await prisma.game.findMany({
      select: {
        id: true,
        status: true,
        scheduledTime: true,
        createdBy: true,
        _count: {
          select: {
            players: true,
            lobbyPlayers: true,
            winners: true
          }
        }
      },
      orderBy: { scheduledTime: 'desc' }
    });

    console.log(`  Found ${games.length} games:\n`);
    games.slice(0, 10).forEach((game, i) => {
      console.log(`  ${i + 1}. ${game.id.substring(0, 8)}... - ${game.status} - ${game.scheduledTime.toISOString()} - Players: ${game._count.players}`);
    });
    if (games.length > 10) {
      console.log(`  ... and ${games.length - 10} more games\n`);
    }

    const gameIds = games.map(g => g.id);

    // Step 3: Count related records
    console.log('\nStep 3: Counting related records...');
    const playerCount = await prisma.player.count({ where: { gameId: { in: gameIds } } });
    const lobbyPlayerCount = await prisma.gameLobbyPlayer.count({ where: { gameId: { in: gameIds } } });
    const winnerCount = await prisma.winner.count({ where: { gameId: { in: gameIds } } });
    const prizeQueueCount = await prisma.prizeQueue.count({ where: { gameId: { in: gameIds } } });

    console.log(`  Players: ${playerCount}`);
    console.log(`  Lobby Players: ${lobbyPlayerCount}`);
    console.log(`  Winners: ${winnerCount}`);
    console.log(`  Prize Queue: ${prizeQueueCount}\n`);

    // Step 4: Delete everything in a transaction
    console.log('Step 4: Deleting all data...');
    await prisma.$transaction(async (tx) => {
      // Delete in correct order (foreign keys)
      await tx.winner.deleteMany({ where: { gameId: { in: gameIds } } });
      console.log('  ✓ Deleted winners');

      await tx.player.deleteMany({ where: { gameId: { in: gameIds } } });
      console.log('  ✓ Deleted players');

      await tx.gameLobbyPlayer.deleteMany({ where: { gameId: { in: gameIds } } });
      console.log('  ✓ Deleted lobby players');

      await tx.prizeQueue.deleteMany({ where: { gameId: { in: gameIds } } });
      console.log('  ✓ Deleted prize queue');

      await tx.game.deleteMany({ where: { id: { in: gameIds } } });
      console.log('  ✓ Deleted games');
    });

    // Final Summary
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                  CLEANUP COMPLETE                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`  Games deleted: ${games.length}`);
    console.log(`  Players deleted: ${playerCount}`);
    console.log(`  Lobby players deleted: ${lobbyPlayerCount}`);
    console.log(`  Winners deleted: ${winnerCount}`);
    console.log(`  Prize queue deleted: ${prizeQueueCount}`);
    console.log(`  Status: ✅ SUCCESS\n`);

  } catch (error) {
    console.error('\n❌ Error during cleanup:');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupProductionGames();
