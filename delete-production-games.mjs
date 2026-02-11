import { PrismaClient } from '@prisma/client';

// Production database URL
const DATABASE_URL = 'postgresql://tambolaadmin:TambolaDB2024SecurePass@tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com:5432/tambola_db';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

async function deleteGames() {
  try {
    console.log('🔍 Connecting to PRODUCTION database...\n');

    // Find all ACTIVE and LOBBY games
    const gamesToDelete = await prisma.game.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { status: 'LOBBY' }
        ]
      },
      select: {
        id: true,
        status: true,
        scheduledTime: true,
        createdBy: true,
        createdAt: true
      }
    });

    console.log(`Found ${gamesToDelete.length} ACTIVE/LOBBY games\n`);

    if (gamesToDelete.length === 0) {
      console.log('✅ No games to delete\n');
      return;
    }

    // Get creator info
    const creatorIds = [...new Set(gamesToDelete.map(g => g.createdBy))];
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
      const count = gamesToDelete.filter(g => g.createdBy === creatorId).length;
      console.log(`  ${creator?.email || 'Unknown'} (${creator?.name || 'N/A'}): ${count} games`);
    });
    console.log('');

    // Show sample games
    console.log('Sample of games to delete:');
    gamesToDelete.slice(0, 10).forEach((game, i) => {
      const creator = creatorMap.get(game.createdBy);
      console.log(`${i + 1}. [${game.status}] ${game.id.substring(0, 8)}... - Scheduled: ${new Date(game.scheduledTime).toLocaleString()} - By: ${creator?.email}`);
    });
    if (gamesToDelete.length > 10) {
      console.log(`... and ${gamesToDelete.length - 10} more games`);
    }
    console.log('');

    console.log(`\n🗑️  Deleting ${gamesToDelete.length} games...\n`);

    // Delete all ACTIVE and LOBBY games
    const result = await prisma.game.deleteMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { status: 'LOBBY' }
        ]
      }
    });

    console.log(`✅ Successfully deleted ${result.count} games!\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

deleteGames();
