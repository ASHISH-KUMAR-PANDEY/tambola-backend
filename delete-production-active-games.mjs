import { PrismaClient } from '@prisma/client';

// Production database URL (MongoDB)
const DATABASE_URL = 'mongodb+srv://stageadmin:ZN0j6OjSj6eEYHJE@tambola-cluster.bmad3.mongodb.net/tambola?retryWrites=true&w=majority';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

async function deleteActiveGames() {
  try {
    console.log('🔍 Connecting to PRODUCTION database...\n');

    // Find all ACTIVE games
    const activeGames = await prisma.game.findMany({
      where: {
        status: 'ACTIVE'
      },
      select: {
        id: true,
        status: true,
        scheduledTime: true,
        createdBy: true,
        createdAt: true
      }
    });

    console.log(`Found ${activeGames.length} ACTIVE games\n`);

    if (activeGames.length === 0) {
      console.log('✅ No active games to delete\n');
      return;
    }

    // Get creator info
    const creatorIds = [...new Set(activeGames.map(g => g.createdBy))];
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

    // Show games by creator
    console.log('Games by Creator:');
    creatorIds.forEach(creatorId => {
      const creator = creatorMap.get(creatorId);
      const count = activeGames.filter(g => g.createdBy === creatorId).length;
      console.log(`  ${creator?.email || 'Unknown'} (${creator?.name || 'N/A'}): ${count} games`);
    });
    console.log('');

    // Show sample games
    console.log('Sample of games to delete:');
    activeGames.slice(0, 5).forEach((game, i) => {
      const creator = creatorMap.get(game.createdBy);
      console.log(`${i + 1}. ${game.id.substring(0, 8)}... - Scheduled: ${new Date(game.scheduledTime).toLocaleString()} - By: ${creator?.email}`);
    });
    console.log('...');
    console.log('');

    console.log(`\n🗑️  Deleting ${activeGames.length} ACTIVE games...\n`);

    // Delete all ACTIVE games
    const result = await prisma.game.deleteMany({
      where: {
        status: 'ACTIVE'
      }
    });

    console.log(`✅ Successfully deleted ${result.count} games!\n`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

deleteActiveGames();
