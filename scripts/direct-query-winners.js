#!/usr/bin/env node

/**
 * Direct database query for winner data
 * Pass production DATABASE_URL as environment variable
 */

const { PrismaClient } = require('@prisma/client');

const GAME_ID = '7566c639-1c81-4fd7-9b64-3389a71667e2';

const WINNER_PLAYER_IDS = [
  '93423bf8-4d63-4256-a55c-684957f9350c',
  'aa4b802b-33d7-40a3-a6ac-f976b08b2f4b',
  '8dab73c5-e340-4d93-8b02-d831983fc45f',
  '053c338c-336f-463f-ace6-1016e1c76fa1',
  '19eac961-8d96-4bd2-bc51-adf0f7f22137',
];

async function main() {
  console.log('DATABASE_URL:', process.env.DATABASE_URL || 'NOT SET');
  console.log('\n🔍 QUERYING DATABASE FOR ALL 5 WINNERS\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable not set');
    console.error('\nUsage:');
    console.error('  DATABASE_URL="postgresql://..." node scripts/direct-query-winners.js');
    console.error('\nGet the DATABASE_URL from AWS App Runner configuration');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✅ Connected to database\n');

    for (let i = 0; i < WINNER_PLAYER_IDS.length; i++) {
      const playerId = WINNER_PLAYER_IDS[i];

      console.log(`\n📊 WINNER #${i + 1}\n`);
      console.log('─────────────────────────────────────────────────────────\n');

      const player = await prisma.player.findUnique({
        where: { id: playerId },
        include: {
          winners: true,
          game: {
            select: {
              id: true,
              scheduledTime: true,
              status: true,
            }
          }
        },
      });

      if (!player) {
        console.log(`❌ Player not found: ${playerId}\n`);
        continue;
      }

      console.log('👤 PLAYER DATA:');
      console.log(`   Player ID: ${player.id}`);
      console.log(`   App User ID: ${player.userId}`);
      console.log(`   Name: ${player.userName}`);
      console.log(`   Joined At: ${player.joinedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      console.log(`   Ticket: ${JSON.stringify(player.ticket)}`);
      console.log('');

      if (player.winners && player.winners.length > 0) {
        console.log('🏆 WINNER RECORDS:');
        player.winners.forEach((w, idx) => {
          console.log(`   Win #${idx + 1}:`);
          console.log(`      Category: ${w.category}`);
          console.log(`      Claimed At: ${w.claimedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
          console.log(`      Prize Claimed: ${w.prizeClaimed}`);
          console.log(`      Prize Value: ${w.prizeValue ? JSON.stringify(w.prizeValue) : 'N/A'}`);
        });
        console.log('');
      }

      const prizeQueue = await prisma.prizeQueue.findMany({
        where: { userId: player.userId, gameId: GAME_ID },
      });

      if (prizeQueue.length > 0) {
        console.log('💰 PRIZE QUEUE:');
        prizeQueue.forEach((pq, idx) => {
          console.log(`   Queue #${idx + 1}:`);
          console.log(`      Category: ${pq.category}`);
          console.log(`      Status: ${pq.status}`);
          console.log(`      Prize Value: ${JSON.stringify(pq.prizeValue)}`);
          console.log(`      Attempts: ${pq.attempts}`);
          console.log(`      Error: ${pq.error || 'None'}`);
        });
        console.log('');
      } else {
        console.log('💰 PRIZE QUEUE: No records\n');
      }

      const user = await prisma.user.findFirst({
        where: { id: player.userId },
      });

      if (user) {
        console.log('👥 USER REGISTRATION:');
        console.log(`   User ID: ${user.id}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Name: ${user.name}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   Created At: ${user.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
        console.log('');
      } else {
        console.log('👥 USER REGISTRATION: Guest player\n');
      }

      console.log('═══════════════════════════════════════════════════════════');
    }

    // Summary
    console.log('\n\n📋 SUMMARY TABLE\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    const players = await prisma.player.findMany({
      where: { id: { in: WINNER_PLAYER_IDS } },
      include: { winners: true },
    });

    console.log('| # | Name                   | Category      | App User ID                          |');
    console.log('|---|------------------------|---------------|--------------------------------------|');

    players.forEach((player, idx) => {
      const winner = player.winners[0];
      const name = player.userName.padEnd(22);
      const category = (winner?.category || 'N/A').padEnd(13);
      console.log(`| ${idx + 1} | ${name} | ${category} | ${player.userId} |`);
    });

    console.log('\n✅ Query complete!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
