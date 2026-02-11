import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  try {
    console.log('🔍 Finding test games...\n');

    // Find all games created by test organizers
    const testOrgEmails = [
      'test-org-01@tambola.test',
      'test-org-02@tambola.test',
      'test-org-03@tambola.test',
      'test-org-04@tambola.test',
      'test-org-05@tambola.test'
    ];

    // Get test organizer user IDs
    const testOrgs = await prisma.user.findMany({
      where: {
        email: { in: testOrgEmails }
      },
      select: { id: true, email: true }
    });

    const testOrgIds = testOrgs.map(org => org.id);
    console.log(`Found ${testOrgs.length} test organizers`);

    // Find games created by test organizers
    const testGames = await prisma.game.findMany({
      where: {
        createdBy: { in: testOrgIds }
      },
      select: {
        id: true,
        status: true,
        scheduledTime: true,
        createdBy: true
      }
    });

    console.log(`Found ${testGames.length} test games\n`);

    if (testGames.length === 0) {
      console.log('✅ No test games to delete\n');
      return;
    }

    // Display games to be deleted
    testGames.forEach((game, i) => {
      console.log(`${i + 1}. Game ${game.id.substring(0, 8)}... - Status: ${game.status} - Scheduled: ${new Date(game.scheduledTime).toLocaleString()}`);
    });

    console.log('\n🗑️  Deleting test games...\n');

    // Delete all test games (cascade will delete related records)
    const result = await prisma.game.deleteMany({
      where: {
        createdBy: { in: testOrgIds }
      }
    });

    console.log(`✅ Deleted ${result.count} test games successfully!\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
