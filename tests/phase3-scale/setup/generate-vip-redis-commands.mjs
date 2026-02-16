#!/usr/bin/env node

/**
 * Generate Redis Commands to Grant VIP Access
 *
 * This script generates Redis commands that you can copy/paste
 * to add all test accounts to the VIP list.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║     GENERATE REDIS COMMANDS FOR VIP ACCESS                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Load test accounts
const accountsPath = path.join(__dirname, 'test-accounts.json');
if (!fs.existsSync(accountsPath)) {
  console.error('❌ test-accounts.json not found');
  console.error('   Run: node setup/create-test-accounts.mjs\n');
  process.exit(1);
}

const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
console.log(`📋 Loaded ${accounts.players.length} players and ${accounts.organizers.length} organizers\n`);

// Collect all user IDs
const allUserIds = [
  ...accounts.players.map(p => p.id),
  ...accounts.organizers.map(o => o.id),
];

console.log('═══════════════════════════════════════════════════════════');
console.log('  COPY AND RUN THESE REDIS COMMANDS');
console.log('═══════════════════════════════════════════════════════════\n');

// Option 1: Single SADD command (most efficient)
console.log('📋 Option 1: Single Command (RECOMMENDED)\n');
console.log('```bash');
console.log(`redis-cli SADD vip:users ${allUserIds.join(' ')}`);
console.log('```\n');

// Option 2: Batch commands (for very large lists)
console.log('📋 Option 2: Batched Commands (if Option 1 fails)\n');
console.log('```bash');

const BATCH_SIZE = 100;
for (let i = 0; i < allUserIds.length; i += BATCH_SIZE) {
  const batch = allUserIds.slice(i, i + BATCH_SIZE);
  console.log(`redis-cli SADD vip:users ${batch.join(' ')}`);
}

console.log('```\n');

// Option 3: Via file (for automation)
console.log('📋 Option 3: Via File (for scripting)\n');

const redisCommandsFile = path.join(__dirname, 'add-vip-users.txt');
const commands = allUserIds.map(id => `SADD vip:users ${id}`).join('\n');
fs.writeFileSync(redisCommandsFile, commands);

console.log(`Saved ${allUserIds.length} commands to: ${redisCommandsFile}\n`);
console.log('Run with:');
console.log('```bash');
console.log(`cat ${redisCommandsFile} | redis-cli`);
console.log('```\n');

// Option 4: CSV format for upload via backend API
console.log('📋 Option 4: CSV File (for backend API upload)\n');

const csvFile = path.join(__dirname, 'vip-users.csv');
const csvContent = 'userId\n' + allUserIds.join('\n');
fs.writeFileSync(csvFile, csvContent);

console.log(`Saved CSV to: ${csvFile}\n`);
console.log('Upload via:');
console.log('```bash');
console.log(`curl -X POST https://nhuh2kfbwk.ap-south-1.awsapprunner.com/api/v1/vip-cohort/upload \\`);
console.log(`  -H "Authorization: Bearer <ORGANIZER_TOKEN>" \\`);
console.log(`  -F "file=@${csvFile}"`);
console.log('```\n');

console.log('═══════════════════════════════════════════════════════════');
console.log('  HOW TO RUN THESE COMMANDS');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('🔧 Method 1: Direct Redis CLI (if you have access)\n');
console.log('```bash');
console.log('# Connect to Redis');
console.log('redis-cli -h tambola-redis-mumbai.jnmrpn.0001.aps1.cache.amazonaws.com\n');
console.log('# Then paste the SADD command from Option 1 above');
console.log('```\n');

console.log('🔧 Method 2: AWS CLI with SSM Session Manager\n');
console.log('```bash');
console.log('# Start session to backend instance');
console.log('aws ssm start-session --target <instance-id> --region ap-south-1\n');
console.log('# Then run redis-cli from the backend');
console.log('```\n');

console.log('🔧 Method 3: Backend API (RECOMMENDED - No AWS Access Needed)\n');
console.log('```bash');
console.log('# Get organizer token from test-accounts.json');
console.log(`ORGANIZER_TOKEN="${accounts.organizers[0].token}"\n`);
console.log('# Upload CSV');
console.log(`curl -X POST https://nhuh2kfbwk.ap-south-1.awsapprunner.com/api/v1/vip-cohort/upload \\`);
console.log(`  -H "Authorization: Bearer $ORGANIZER_TOKEN" \\`);
console.log(`  -F "file=@${csvFile}"`);
console.log('```\n');

console.log('🔧 Method 4: Run from Backend Server (SSH)\n');
console.log('```bash');
console.log('# SSH to backend server, then:');
console.log('cd /app  # Or wherever backend is deployed');
console.log('node -e \'');
console.log('  const Redis = require("ioredis");');
console.log('  const redis = new Redis(process.env.REDIS_URL);');
const userIdsStr = JSON.stringify(allUserIds);
console.log(`  const ids = ${userIdsStr};`);
console.log('  redis.sadd("vip:users", ...ids).then(() => {');
console.log('    console.log("Added", ids.length, "users to VIP");');
console.log('    redis.disconnect();');
console.log('  });');
console.log("'");
console.log('```\n');

console.log('═══════════════════════════════════════════════════════════');
console.log('  VERIFICATION');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('After adding users, verify with:\n');
console.log('```bash');
console.log('# Check total VIP count');
console.log('redis-cli SCARD vip:users\n');
console.log('# Check specific user');
console.log(`redis-cli SISMEMBER vip:users ${allUserIds[0]}\n`);
console.log('# Should return 1 if user is VIP');
console.log('```\n');

console.log('Or via backend API:');
console.log('```bash');
console.log(`curl https://nhuh2kfbwk.ap-south-1.awsapprunner.com/api/v1/vip-cohort/stats \\`);
console.log(`  -H "Authorization: Bearer ${accounts.organizers[0].token}"`);
console.log('```\n');

console.log('✅ Files created:');
console.log(`   - ${redisCommandsFile}`);
console.log(`   - ${csvFile}\n`);

console.log('📋 Next steps:');
console.log('   1. Choose a method above and add test users to VIP');
console.log('   2. Verify VIP access granted');
console.log('   3. Run diagnostic tests:');
console.log('      npx playwright test diagnostics/01-join-latency-test.spec.ts --reporter=list\n');
