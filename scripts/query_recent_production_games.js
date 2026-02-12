import { PrismaClient } from '@prisma/client';

// This script queries production database for recent games with specific users
// Usage: DATABASE_URL="postgresql://..." node scripts/query_recent_production_games.js

const prisma = new PrismaClient();

const userId1 = '66d82fddce84f9482889e0d1';
const userId2 = '676e6f8d322565ca6aa4c546';

async function main() {
  console.log('🔍 QUERYING PRODUCTION FOR RECENT GAMES');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Target Users:');
  console.log(`  User 1: ${userId1}`);
  console.log(`  User 2: ${userId2}`);
  console.log('');

  // Verify connection
  try {
    await prisma.$connect();
    const dbHost = process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'Unknown';
    console.log('✅ Connected to:', dbHost);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to connect to database');
    console.error('ERROR DETAILS:', error);
    console.error('Set DATABASE_URL environment variable to production database');
    console.error('Example: DATABASE_URL="postgresql://user:pass@host:port/db" node scripts/query_recent_production_games.js');
    process.exit(1);
  }

  // Get all games from last 2 hours
  const twoHoursAgo = new Date();
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

  console.log('🕐 Searching for games from last 2 hours...');
  console.log(`   After: ${twoHoursAgo.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log('');

  const recentGames = await prisma.game.findMany({
    where: {
      scheduledTime: {
        gte: twoHoursAgo
      }
    },
    orderBy: {
      scheduledTime: 'desc'
    }
  });

  console.log(`📊 Found ${recentGames.length} games in last 2 hours`);
  console.log('');

  if (recentGames.length === 0) {
    console.log('⚠️  No recent games found. Expanding search to last 24 hours...');
    console.log('');

    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const dailyGames = await prisma.game.findMany({
      where: {
        scheduledTime: {
          gte: oneDayAgo
        }
      },
      orderBy: {
        scheduledTime: 'desc'
      }
    });

    console.log(`📊 Found ${dailyGames.length} games in last 24 hours`);
    console.log('');

    for (const game of dailyGames) {
      await analyzeGame(game);
    }
  } else {
    for (const game of recentGames) {
      await analyzeGame(game);
    }
  }

  // Check specific user activity
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('👥 CHECKING USER ACTIVITY');
  console.log('');

  for (const userId of [userId1, userId2]) {
    console.log(`User: ${userId}`);

    const playerRecords = await prisma.player.findMany({
      where: { userId },
      include: {
        game: true,
        winners: true
      },
      orderBy: {
        joinedAt: 'desc'
      },
      take: 5
    });

    console.log(`  Player records: ${playerRecords.length}`);

    if (playerRecords.length > 0) {
      playerRecords.forEach((p, i) => {
        console.log(`  ${i + 1}. Game ${p.gameId}`);
        console.log(`     Name: ${p.userName}`);
        console.log(`     Joined: ${p.joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        console.log(`     Game Status: ${p.game.status}`);
        console.log(`     Winners: ${p.winners.length}`);
        if (p.winners.length > 0) {
          p.winners.forEach(w => console.log(`       - ${w.category}`));
        }
      });
    }

    const lobbyRecords = await prisma.gameLobbyPlayer.findMany({
      where: { userId }
    });

    console.log(`  Lobby records: ${lobbyRecords.length}`);
    if (lobbyRecords.length > 0) {
      lobbyRecords.forEach(l => {
        console.log(`    - Game ${l.gameId}: ${l.userName}`);
      });
    }

    console.log('');
  }
}

async function analyzeGame(game) {
  const players = await prisma.player.findMany({
    where: { gameId: game.id },
    include: {
      winners: true
    }
  });

  const winners = await prisma.winner.findMany({
    where: { gameId: game.id },
    include: {
      player: true
    }
  });

  const hasUser1 = players.some(p => p.userId === userId1);
  const hasUser2 = players.some(p => p.userId === userId2);
  const hasBothUsers = hasUser1 && hasUser2;

  const marker = hasBothUsers ? ' 🎯 BOTH USERS!' : (hasUser1 || hasUser2 ? ' 👤' : '');

  console.log(`${'═'.repeat(63)}`);
  console.log(`🎮 GAME: ${game.id}${marker}`);
  console.log(`${'═'.repeat(63)}`);
  console.log(`Status: ${game.status}`);
  console.log(`Scheduled: ${game.scheduledTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log(`Started: ${game.startedAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) || 'N/A'}`);
  console.log(`Ended: ${game.endedAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) || 'N/A'}`);
  console.log(`Created By: ${game.createdBy}`);
  console.log(`Called Numbers: ${(game.calledNumbers || []).length}`);
  console.log(`Current Number: ${game.currentNumber || 'N/A'}`);
  console.log('');

  console.log(`👥 PLAYERS (${players.length}):`);
  players.forEach((p, i) => {
    const userMarker = p.userId === userId1 ? ' [USER 1]' : p.userId === userId2 ? ' [USER 2]' : '';
    console.log(`${i + 1}. ${p.userName}${userMarker}`);
    console.log(`   User ID: ${p.userId}`);
    console.log(`   Player ID: ${p.id}`);
    console.log(`   Joined: ${p.joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    if (p.winners.length > 0) {
      console.log(`   Won: ${p.winners.map(w => w.category).join(', ')}`);
    }
  });

  if (winners.length > 0) {
    console.log('');
    console.log(`🏆 WINNERS (${winners.length}):`);
    winners.forEach((w, i) => {
      console.log(`${i + 1}. ${w.player.userName} - ${w.category}`);
      console.log(`   Claimed: ${w.claimedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    });
  }

  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
