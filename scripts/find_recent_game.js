import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function findRecentGame() {
  const userId1 = '66d82fddce84f9482889e0d1';
  const userId2 = '676e6f8d322565ca6aa4c546';

  console.log('🔍 Searching for recent games with these users...');
  console.log('User 1:', userId1);
  console.log('User 2:', userId2);
  console.log('');

  // Find all games where either user was a player
  const players = await prisma.player.findMany({
    where: {
      OR: [
        { userId: userId1 },
        { userId: userId2 }
      ]
    },
    include: {
      game: true
    }
  });

  console.log('📊 Found', players.length, 'player records total');

  // Group by gameId to find games with both users
  const gameMap = new Map();
  players.forEach(p => {
    if (!gameMap.has(p.gameId)) {
      gameMap.set(p.gameId, {
        game: p.game,
        players: []
      });
    }
    gameMap.get(p.gameId).players.push(p);
  });

  console.log('📊 Found', gameMap.size, 'unique games');
  console.log('');

  // Find games with BOTH users, sorted by game startedAt
  const gamesWithBoth = [];
  for (const [gameId, data] of gameMap.entries()) {
    const userIds = data.players.map(p => p.userId);
    if (userIds.includes(userId1) && userIds.includes(userId2)) {
      gamesWithBoth.push({ gameId, ...data });
    }
  }

  gamesWithBoth.sort((a, b) => {
    const aTime = a.game.startedAt || a.game.scheduledTime;
    const bTime = b.game.startedAt || b.game.scheduledTime;
    return new Date(bTime) - new Date(aTime);
  });

  if (gamesWithBoth.length > 0) {
    console.log('✅ Found', gamesWithBoth.length, 'game(s) with both users');
    const targetGame = gamesWithBoth[0];
    console.log('');
    console.log('🎯 Most Recent Game:');
    console.log('  Game ID:', targetGame.gameId);
    console.log('  Status:', targetGame.game.status);
    console.log('  Scheduled Time:', targetGame.game.scheduledTime);
    console.log('  Started At:', targetGame.game.startedAt);
    console.log('  Ended At:', targetGame.game.endedAt);
    console.log('  Players in this game:', targetGame.players.length);
    console.log('');

    return targetGame.gameId;
  } else {
    console.log('⚠️  No game found with both users together');
  }

  await prisma.$disconnect();
}

findRecentGame().then(gameId => {
  if (gameId) {
    console.log('TARGET_GAME_ID=' + gameId);
    process.exit(0);
  } else {
    process.exit(1);
  }
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
