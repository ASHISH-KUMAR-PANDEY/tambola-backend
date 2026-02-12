import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function investigate() {
  const userId1 = '66d82fddce84f9482889e0d1';
  const userId2 = '676e6f8d322565ca6aa4c546';

  console.log('🔍 INVESTIGATION: Recent game with these users');
  console.log('User 1:', userId1);
  console.log('User 2:', userId2);
  console.log('='.repeat(80));
  console.log('');

  // 1. Check if users exist
  console.log('1️⃣  CHECKING USER RECORDS');
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { id: userId1 },
        { id: userId2 }
      ]
    }
  });
  console.log('Users found:', users.length);
  users.forEach(u => {
    console.log(`  - ${u.id}: ${u.name} (${u.email})`);
  });
  console.log('');

  // 2. Check recent games (all states)
  console.log('2️⃣  CHECKING RECENT GAMES (last 10)');
  const recentGames = await prisma.game.findMany({
    orderBy: {
      scheduledTime: 'desc'
    },
    take: 10
  });
  console.log('Recent games:', recentGames.length);
  recentGames.forEach(g => {
    console.log(`  - ${g.id}: ${g.status} | Scheduled: ${g.scheduledTime} | Started: ${g.startedAt || 'N/A'}`);
  });
  console.log('');

  // 3. Check player records for these users
  console.log('3️⃣  CHECKING PLAYER RECORDS');
  const players1 = await prisma.player.findMany({
    where: { userId: userId1 },
    include: { game: true }
  });
  const players2 = await prisma.player.findMany({
    where: { userId: userId2 },
    include: { game: true }
  });

  console.log(`User 1 (${userId1}) player records:`, players1.length);
  players1.forEach(p => {
    console.log(`  - Game ${p.gameId}: ${p.userName} | Status: ${p.game.status} | Started: ${p.game.startedAt || 'N/A'}`);
  });

  console.log(`User 2 (${userId2}) player records:`, players2.length);
  players2.forEach(p => {
    console.log(`  - Game ${p.gameId}: ${p.userName} | Status: ${p.game.status} | Started: ${p.game.startedAt || 'N/A'}`);
  });
  console.log('');

  // 4. Check lobby records
  console.log('4️⃣  CHECKING WAITING LOBBY RECORDS');
  const lobby1 = await prisma.gameLobbyPlayer.findMany({
    where: { userId: userId1 }
  });
  const lobby2 = await prisma.gameLobbyPlayer.findMany({
    where: { userId: userId2 }
  });

  console.log(`User 1 in lobbies:`, lobby1.length);
  lobby1.forEach(l => {
    console.log(`  - Game ${l.gameId}: ${l.userName}`);
  });

  console.log(`User 2 in lobbies:`, lobby2.length);
  lobby2.forEach(l => {
    console.log(`  - Game ${l.gameId}: ${l.userName}`);
  });
  console.log('');

  // 5. Find common games
  console.log('5️⃣  FINDING COMMON GAMES');
  const allGameIds1 = [...new Set([...players1.map(p => p.gameId), ...lobby1.map(l => l.gameId)])];
  const allGameIds2 = [...new Set([...players2.map(p => p.gameId), ...lobby2.map(l => l.gameId)])];

  const commonGameIds = allGameIds1.filter(id => allGameIds2.includes(id));

  if (commonGameIds.length > 0) {
    console.log('✅ Found', commonGameIds.length, 'game(s) with both users:');

    for (const gameId of commonGameIds) {
      const game = await prisma.game.findUnique({
        where: { id: gameId }
      });

      const allPlayers = await prisma.player.findMany({
        where: { gameId }
      });

      const winners = await prisma.winner.findMany({
        where: { gameId },
        include: { player: true }
      });

      console.log('');
      console.log('  🎯 GAME:', gameId);
      console.log('     Status:', game.status);
      console.log('     Scheduled:', game.scheduledTime);
      console.log('     Started:', game.startedAt || 'N/A');
      console.log('     Ended:', game.endedAt || 'N/A');
      console.log('     Total Players:', allPlayers.length);
      console.log('     Called Numbers:', (game.calledNumbers || []).length);
      console.log('     Current Number:', game.currentNumber || 'N/A');
      console.log('     Winners:', winners.length);

      if (winners.length > 0) {
        winners.forEach(w => {
          console.log(`       - ${w.player.userName}: ${w.category}`);
        });
      }

      console.log('     Players:');
      allPlayers.forEach(p => {
        const isUser1 = p.userId === userId1;
        const isUser2 = p.userId === userId2;
        const marker = isUser1 || isUser2 ? ' 👤' : '';
        console.log(`       - ${p.userId.substring(0, 12)}...: ${p.userName}${marker}`);
      });
    }

    return commonGameIds[0]; // Return most recent
  } else {
    console.log('❌ No common games found');
  }

  await prisma.$disconnect();
}

investigate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
