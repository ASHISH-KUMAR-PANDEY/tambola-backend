import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkTodayGames() {
  console.log('🔍 CHECKING GAMES FROM TODAY');
  console.log('Current time:', new Date());
  console.log('='.repeat(80));
  console.log('');

  // Get all games
  const allGames = await prisma.game.findMany({
    orderBy: {
      scheduledTime: 'desc'
    }
  });

  console.log('Total games in database:', allGames.length);
  console.log('');

  if (allGames.length > 0) {
    console.log('Last 5 games:');
    allGames.slice(0, 5).forEach((g, i) => {
      console.log(`${i + 1}. Game ID: ${g.id}`);
      console.log(`   Status: ${g.status}`);
      console.log(`   Scheduled: ${g.scheduledTime}`);
      console.log(`   Started: ${g.startedAt || 'N/A'}`);
      console.log(`   Ended: ${g.endedAt || 'N/A'}`);
      console.log(`   Created By: ${g.createdBy}`);
      console.log('');
    });
  }

  // Check for games from last 24 hours
  const yesterday = new Date();
  yesterday.setHours(yesterday.getHours() - 24);

  const recentGames = await prisma.game.findMany({
    where: {
      scheduledTime: {
        gte: yesterday
      }
    },
    orderBy: {
      scheduledTime: 'desc'
    }
  });

  console.log(`Games from last 24 hours: ${recentGames.length}`);
  if (recentGames.length > 0) {
    console.log('');
    for (const game of recentGames) {
      const players = await prisma.player.findMany({
        where: { gameId: game.id }
      });

      const winners = await prisma.winner.findMany({
        where: { gameId: game.id },
        include: { player: true }
      });

      console.log(`📋 Game: ${game.id}`);
      console.log(`   Status: ${game.status}`);
      console.log(`   Scheduled: ${game.scheduledTime}`);
      console.log(`   Started: ${game.startedAt || 'N/A'}`);
      console.log(`   Players: ${players.length}`);
      console.log(`   Winners: ${winners.length}`);

      if (players.length > 0) {
        console.log(`   Player List:`);
        players.forEach(p => {
          console.log(`     - ${p.userId}: ${p.userName}`);
        });
      }
      console.log('');
    }
  }

  await prisma.$disconnect();
}

checkTodayGames().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
