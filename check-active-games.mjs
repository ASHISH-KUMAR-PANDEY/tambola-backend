import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkActiveGames() {
  try {
    console.log('🔍 Checking ACTIVE games...\n');

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
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`Found ${activeGames.length} ACTIVE games\n`);

    if (activeGames.length === 0) {
      console.log('✅ No active games found\n');
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

    // Display creator summary
    console.log('Games by Creator:');
    creatorIds.forEach(creatorId => {
      const creator = creatorMap.get(creatorId);
      const count = activeGames.filter(g => g.createdBy === creatorId).length;
      console.log(`  ${creator?.email || 'Unknown'} (${creator?.name || 'N/A'}): ${count} games`);
    });
    console.log('');

    // Show first 10 games
    console.log('Recent ACTIVE Games:');
    console.log('─'.repeat(100));
    activeGames.slice(0, 10).forEach((game, i) => {
      const creator = creatorMap.get(game.createdBy);
      console.log(`${i + 1}. ${game.id.substring(0, 8)}...`);
      console.log(`   Scheduled: ${new Date(game.scheduledTime).toLocaleString()}`);
      console.log(`   Created: ${new Date(game.createdAt).toLocaleString()}`);
      console.log(`   Creator: ${creator?.email || 'Unknown'}`);
      console.log('');
    });

    // Check if they're test games
    const testGames = activeGames.filter(g => {
      const creator = creatorMap.get(g.createdBy);
      return creator?.email?.includes('test-');
    });

    if (testGames.length > 0) {
      console.log(`\n⚠️  ${testGames.length} games were created by test accounts and can be deleted`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

checkActiveGames();
