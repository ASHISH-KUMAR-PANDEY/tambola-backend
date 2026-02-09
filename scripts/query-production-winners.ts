import { PrismaClient } from '@prisma/client';

// This script needs the production DATABASE_URL
// Set it via environment variable: DATABASE_URL="postgresql://..."

const prisma = new PrismaClient();

const GAME_ID = '7566c639-1c81-4fd7-9b64-3389a71667e2';

const WINNER_PLAYER_IDS = [
  '93423bf8-4d63-4256-a55c-684957f9350c', // Shyam Nandan Kumar - EARLY_5
  'aa4b802b-33d7-40a3-a6ac-f976b08b2f4b', // Puran mal - TOP_LINE
  '8dab73c5-e340-4d93-8b02-d831983fc45f', // Pankaj saini - MIDDLE_LINE
  '053c338c-336f-463f-ace6-1016e1c76fa1', // Poonam - BOTTOM_LINE
  '19eac961-8d96-4bd2-bc51-adf0f7f22137', // Amit Kumar - FULL_HOUSE
];

async function main() {
  console.log('🔍 QUERYING PRODUCTION DATABASE FOR ALL 5 WINNERS\n');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Database:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'Unknown');
  console.log('Game ID:', GAME_ID);
  console.log('\n');

  // First, verify we can connect
  try {
    await prisma.$connect();
    console.log('✅ Connected to database\n');
  } catch (error) {
    console.error('❌ Failed to connect to database');
    console.error('Make sure DATABASE_URL environment variable is set to production database');
    console.error('Error:', error);
    process.exit(1);
  }

  // Get game data first
  const game = await prisma.game.findUnique({
    where: { id: GAME_ID },
  });

  if (!game) {
    console.error('❌ Game not found:', GAME_ID);
    process.exit(1);
  }

  console.log('📊 GAME OVERVIEW\n');
  console.log('Game ID:', game.id);
  console.log('Status:', game.status);
  console.log('Scheduled:', game.scheduledTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  console.log('Started:', game.startedAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) || 'N/A');
  console.log('Ended:', game.endedAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) || 'N/A');
  console.log('Numbers Called:', game.calledNumbers.length);
  console.log('\n═══════════════════════════════════════════════════════════\n');

  // Query all winners
  for (let i = 0; i < WINNER_PLAYER_IDS.length; i++) {
    const playerId = WINNER_PLAYER_IDS[i];

    console.log(`\n📊 WINNER #${i + 1}\n`);
    console.log('─────────────────────────────────────────────────────────\n');

    // Get Player data
    const player = await prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      console.log(`❌ Player not found: ${playerId}\n`);
      continue;
    }

    console.log('👤 PLAYER DATA:');
    console.log(`   Player ID: ${player.id}`);
    console.log(`   App User ID (userId): ${player.userId}`);
    console.log(`   Name: ${player.userName}`);
    console.log(`   Game ID: ${player.gameId}`);
    console.log(`   Joined At: ${player.joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    console.log(`   Ticket:\n${JSON.stringify(player.ticket, null, 2)}`);
    console.log('');

    // Get Winner record
    const winner = await prisma.winner.findFirst({
      where: { playerId: playerId },
    });

    if (winner) {
      console.log('🏆 WINNER DATA:');
      console.log(`   Winner ID: ${winner.id}`);
      console.log(`   Category: ${winner.category}`);
      console.log(`   Claimed At: ${winner.claimedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      console.log(`   Prize Claimed: ${winner.prizeClaimed}`);
      console.log(`   Prize Value: ${winner.prizeValue ? JSON.stringify(winner.prizeValue, null, 2) : 'N/A'}`);
      console.log('');
    }

    // Get Prize Queue records (if any)
    const prizeQueue = await prisma.prizeQueue.findMany({
      where: { userId: player.userId, gameId: player.gameId },
    });

    if (prizeQueue.length > 0) {
      console.log('💰 PRIZE QUEUE DATA:');
      prizeQueue.forEach((pq, index) => {
        console.log(`   Queue #${index + 1}:`);
        console.log(`      ID: ${pq.id}`);
        console.log(`      Category: ${pq.category}`);
        console.log(`      Status: ${pq.status}`);
        console.log(`      Prize Value: ${JSON.stringify(pq.prizeValue, null, 2)}`);
        console.log(`      Attempts: ${pq.attempts}`);
        console.log(`      Last Attempt: ${pq.lastAttempt ? pq.lastAttempt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}`);
        console.log(`      Error: ${pq.error || 'None'}`);
        console.log(`      Idempotency Key: ${pq.idempotencyKey || 'N/A'}`);
        console.log(`      Created At: ${pq.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        console.log('');
      });
    } else {
      console.log('💰 PRIZE QUEUE DATA: No records found\n');
    }

    // Check if this userId is a registered user
    const user = await prisma.user.findFirst({
      where: { id: player.userId },
    });

    if (user) {
      console.log('👥 USER REGISTRATION DATA:');
      console.log(`   User ID: ${user.id}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Name: ${user.name}`);
      console.log(`   Role: ${user.role}`);
      console.log(`   Created At: ${user.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      console.log(`   Updated At: ${user.updatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      console.log('');
    } else {
      console.log('👥 USER REGISTRATION DATA: Not a registered user (guest player)\n');
    }

    console.log('═══════════════════════════════════════════════════════════');
  }

  // Summary table
  console.log('\n\n📋 SUMMARY TABLE\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const players = await prisma.player.findMany({
    where: { id: { in: WINNER_PLAYER_IDS } },
    include: {
      winners: true,
    },
  });

  console.log('| # | Name                   | Category      | App User ID                          | Prize Claimed |');
  console.log('|---|------------------------|---------------|--------------------------------------|---------------|');

  for (const player of players) {
    const winner = player.winners[0];
    const index = WINNER_PLAYER_IDS.indexOf(player.id) + 1;
    const name = player.userName.padEnd(22);
    const category = (winner?.category || 'N/A').padEnd(13);
    const appUserId = player.userId;
    const claimed = winner?.prizeClaimed ? 'Yes' : 'No';
    console.log(`| ${index} | ${name} | ${category} | ${appUserId} | ${claimed.padEnd(13)} |`);
  }

  console.log('\n');
  console.log('✅ Query complete!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
