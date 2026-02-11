import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkGames() {
  try {
    console.log('🔍 Checking lobby games...\n');

    // Find all LOBBY games
    const lobbyGames = await prisma.game.findMany({
      where: {
        status: 'LOBBY'
      },
      select: {
        id: true,
        status: true,
        scheduledTime: true,
        createdBy: true,
        createdAt: true
      },
      orderBy: {
        scheduledTime: 'asc'
      }
    });

    console.log(`Found ${lobbyGames.length} LOBBY games\n`);

    if (lobbyGames.length === 0) {
      console.log('✅ No lobby games found\n');
      return;
    }

    // Get creator info for each game
    const creatorIds = [...new Set(lobbyGames.map(g => g.createdBy))];
    const creators = await prisma.user.findMany({
      where: {
        id: { in: creatorIds }
      },
      select: {
        id: true,
        email: true,
        name: true
      }
    });

    const creatorMap = new Map(creators.map(c => [c.id, c]));

    // Display games
    console.log('Lobby Games:');
    console.log('─'.repeat(100));
    lobbyGames.forEach((game, i) => {
      const creator = creatorMap.get(game.createdBy);
      console.log(`${i + 1}. Game: ${game.id.substring(0, 8)}...`);
      console.log(`   Scheduled: ${new Date(game.scheduledTime).toLocaleString()}`);
      console.log(`   Created: ${new Date(game.createdAt).toLocaleString()}`);
      console.log(`   Creator: ${creator?.email || 'Unknown'} (${creator?.name || 'N/A'})`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

checkGames();
