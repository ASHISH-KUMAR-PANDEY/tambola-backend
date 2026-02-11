import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkGames() {
  try {
    console.log('🔍 Checking all games...\n');

    // Find all games grouped by status
    const games = await prisma.game.findMany({
      select: {
        id: true,
        status: true,
        scheduledTime: true,
        createdBy: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50 // Last 50 games
    });

    console.log(`Found ${games.length} games (showing last 50)\n`);

    if (games.length === 0) {
      console.log('✅ No games found\n');
      return;
    }

    // Count by status
    const statusCounts = games.reduce((acc, game) => {
      acc[game.status] = (acc[game.status] || 0) + 1;
      return acc;
    }, {});

    console.log('Games by Status:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    console.log('');

    // Get creator info
    const creatorIds = [...new Set(games.map(g => g.createdBy))];
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

    // Display recent games
    console.log('Recent Games:');
    console.log('─'.repeat(100));
    games.slice(0, 20).forEach((game, i) => {
      const creator = creatorMap.get(game.createdBy);
      console.log(`${i + 1}. [${game.status}] ${game.id.substring(0, 8)}...`);
      console.log(`   Scheduled: ${new Date(game.scheduledTime).toLocaleString()}`);
      console.log(`   Created: ${new Date(game.createdAt).toLocaleString()}`);
      console.log(`   Creator: ${creator?.email || 'Unknown'}`);
      console.log('');
    });

    // Show test account games
    const testGames = games.filter(g => {
      const creator = creatorMap.get(g.createdBy);
      return creator?.email?.includes('test-');
    });

    if (testGames.length > 0) {
      console.log(`\n⚠️  Found ${testGames.length} games created by test accounts`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

checkGames();
