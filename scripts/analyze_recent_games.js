import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function analyzeGames() {
  console.log('📊 COMPREHENSIVE GAME ANALYSIS');
  console.log('='.repeat(80));
  console.log('');

  const games = await prisma.game.findMany({
    orderBy: {
      scheduledTime: 'desc'
    }
  });

  for (const game of games) {
    console.log('🎮 GAME:', game.id);
    console.log('   Status:', game.status);
    console.log('   Scheduled:', game.scheduledTime);
    console.log('   Started:', game.startedAt || 'N/A');
    console.log('   Ended:', game.endedAt || 'N/A');
    console.log('   Created By:', game.createdBy);
    console.log('   Called Numbers:', (game.calledNumbers || []).length, 'numbers');
    console.log('   Current Number:', game.currentNumber || 'N/A');
    console.log('');

    // Get all players
    const players = await prisma.player.findMany({
      where: { gameId: game.id }
    });

    console.log('   👥 PLAYERS:', players.length);
    players.forEach((p, i) => {
      console.log(`   ${i + 1}. User ID: ${p.userId}`);
      console.log(`      Name: ${p.userName}`);
      console.log(`      Player ID: ${p.id}`);
      console.log(`      Joined: ${p.joinedAt}`);
    });
    console.log('');

    // Get winners
    const winners = await prisma.winner.findMany({
      where: { gameId: game.id },
      include: { player: true }
    });

    if (winners.length > 0) {
      console.log('   🏆 WINNERS:', winners.length);
      winners.forEach((w, i) => {
        console.log(`   ${i + 1}. ${w.player.userName} - ${w.category}`);
        console.log(`      Player ID: ${w.playerId}`);
        console.log(`      User ID: ${w.player.userId}`);
      });
    } else {
      console.log('   🏆 WINNERS: None');
    }

    console.log('');
    console.log('   💎 PRIZES:');
    console.log(`      Early 5: ${game.prizes?.early5 || 'N/A'}`);
    console.log(`      Top Line: ${game.prizes?.topLine || 'N/A'}`);
    console.log(`      Middle Line: ${game.prizes?.middleLine || 'N/A'}`);
    console.log(`      Bottom Line: ${game.prizes?.bottomLine || 'N/A'}`);
    console.log(`      Full House: ${game.prizes?.fullHouse || 'N/A'}`);
    console.log('');
    console.log('='.repeat(80));
    console.log('');
  }

  await prisma.$disconnect();
}

analyzeGames().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
