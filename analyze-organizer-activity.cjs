const { PrismaClient } = require('@prisma/client');

const GAME_ID = '7566c639-1c81-4fd7-9b64-3389a71667e2';

async function main() {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✅ Connected to database\n');
    console.log('='.repeat(70));
    console.log('ORGANIZER ACTIVITY ANALYSIS');
    console.log('='.repeat(70));

    // Get game details
    const game = await prisma.game.findUnique({
      where: { id: GAME_ID },
      include: {
        creator: true,
      },
    });

    if (!game) {
      console.log('❌ Game not found');
      process.exit(1);
    }

    console.log('\n📊 GAME TIMELINE\n');
    console.log(`Created:    ${game.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    console.log(`Scheduled:  ${game.scheduledTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    console.log(`Started:    ${game.startedAt ? game.startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'NOT STARTED'}`);
    console.log(`Ended:      ${game.endedAt ? game.endedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'NOT ENDED'}`);
    console.log(`Status:     ${game.status}`);

    console.log('\n👤 ORGANIZER\n');
    console.log(`User ID:    ${game.createdBy}`);
    console.log(`Name:       ${game.creator?.name || 'N/A'}`);
    console.log(`Email:      ${game.creator?.email || 'N/A'}`);
    console.log(`Role:       ${game.creator?.role || 'N/A'}`);

    console.log('\n🔢 NUMBERS CALLED\n');
    const calledNumbers = game.calledNumbers || [];
    console.log(`Total numbers called: ${calledNumbers.length}`);
    if (calledNumbers.length > 0) {
      console.log(`First 10: ${calledNumbers.slice(0, 10).join(', ')}`);
      console.log(`Last 10:  ${calledNumbers.slice(-10).join(', ')}`);
    }

    // Calculate timing
    if (game.startedAt && game.endedAt) {
      const durationMs = game.endedAt.getTime() - game.startedAt.getTime();
      const durationMin = Math.floor(durationMs / 60000);
      console.log(`\nGame duration: ${durationMin} minutes`);

      if (calledNumbers.length > 0) {
        const avgTimePerNumber = durationMs / calledNumbers.length / 1000; // seconds
        console.log(`Average time per number: ${avgTimePerNumber.toFixed(1)} seconds`);
      }
    }

    // Get winner timeline
    console.log('\n🏆 WINNER TIMELINE\n');
    const winners = await prisma.winner.findMany({
      where: { gameId: GAME_ID },
      include: {
        player: {
          select: { userName: true }
        }
      },
      orderBy: { claimedAt: 'asc' },
    });

    winners.forEach((winner, idx) => {
      const claimTime = winner.claimedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const numbersCalledAtClaim = calledNumbers.length; // This is approximate
      console.log(`${idx + 1}. ${winner.category.padEnd(15)} - ${winner.player.userName.padEnd(25)} - ${claimTime}`);

      // Calculate time from game start
      if (game.startedAt) {
        const timeSinceStart = Math.floor((winner.claimedAt.getTime() - game.startedAt.getTime()) / 60000);
        console.log(`   (${timeSinceStart} minutes after game start)`);
      }
    });

    // Check for issues
    console.log('\n⚠️  POTENTIAL ISSUES\n');
    let issuesFound = false;

    // Issue 1: Scheduled vs Started time gap
    const scheduleDelay = game.startedAt ?
      Math.floor((game.startedAt.getTime() - game.scheduledTime.getTime()) / 60000) : null;
    if (scheduleDelay && Math.abs(scheduleDelay) > 10) {
      console.log(`❌ Game started ${Math.abs(scheduleDelay)} minutes ${scheduleDelay > 0 ? 'late' : 'early'}`);
      issuesFound = true;
    }

    // Issue 2: Too many or too few numbers
    if (calledNumbers.length > 90) {
      console.log(`❌ More than 90 numbers called (${calledNumbers.length})`);
      issuesFound = true;
    }
    if (game.status === 'COMPLETED' && calledNumbers.length < 15) {
      console.log(`❌ Game completed with very few numbers (${calledNumbers.length})`);
      issuesFound = true;
    }

    // Issue 3: Game duration
    if (game.startedAt && game.endedAt) {
      const durationMin = Math.floor((game.endedAt.getTime() - game.startedAt.getTime()) / 60000);
      if (durationMin > 120) {
        console.log(`❌ Game took very long: ${durationMin} minutes`);
        issuesFound = true;
      }
      if (durationMin < 5 && game.status === 'COMPLETED') {
        console.log(`❌ Game completed too quickly: ${durationMin} minutes`);
        issuesFound = true;
      }
    }

    // Issue 4: Missing winners
    if (game.status === 'COMPLETED' && winners.length < 5) {
      console.log(`❌ Game completed but only ${winners.length}/5 winners`);
      issuesFound = true;
    }

    // Issue 5: Duplicate numbers
    const uniqueNumbers = new Set(calledNumbers);
    if (uniqueNumbers.size !== calledNumbers.length) {
      console.log(`❌ Duplicate numbers called (${calledNumbers.length} total, ${uniqueNumbers.size} unique)`);
      issuesFound = true;
    }

    if (!issuesFound) {
      console.log('✅ No obvious issues detected in game data');
    }

    console.log('\n' + '='.repeat(70));

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
