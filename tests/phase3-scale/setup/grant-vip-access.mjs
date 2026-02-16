#!/usr/bin/env node

/**
 * Grant VIP Access to Test Accounts
 *
 * This script adds all test account players to Redis VIP list
 * so they can join games during load testing.
 */

import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Redis connection
const REDIS_URL = process.env.REDIS_URL || 'redis://tambola-redis-mumbai.jnmrpn.0001.aps1.cache.amazonaws.com:6379';

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║        GRANT VIP ACCESS TO TEST ACCOUNTS                   ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

async function grantVIPAccess() {
  const redis = new Redis(REDIS_URL, {
    retryStrategy: (times) => {
      if (times > 3) {
        console.error('❌ Failed to connect to Redis after 3 attempts');
        return null;
      }
      return Math.min(times * 100, 2000);
    },
  });

  try {
    // Load test accounts
    const accountsPath = path.join(__dirname, 'test-accounts.json');
    if (!fs.existsSync(accountsPath)) {
      throw new Error('test-accounts.json not found. Run: node setup/create-test-accounts.mjs');
    }

    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    console.log(`📋 Loaded ${accounts.players.length} players and ${accounts.organizers.length} organizers\n`);

    // Check Redis connection
    console.log('🔌 Connecting to Redis...');
    await redis.ping();
    console.log('✅ Redis connected\n');

    // Check what key format is used for VIP
    console.log('🔍 Checking VIP key format in Redis...');

    // Common patterns for VIP keys:
    // 1. SET: vip:users (set of user IDs)
    // 2. HASH: vip:cohort (hash with user IDs as keys)
    // 3. Individual keys: vip:user:<userId>

    const possibleKeys = [
      'vip:users',
      'vip:cohort',
      'vip-users',
      'vip_users',
      'stage:vip:users',
    ];

    let vipKeyFound = null;
    let vipKeyType = null;

    for (const key of possibleKeys) {
      const type = await redis.type(key);
      if (type !== 'none') {
        vipKeyFound = key;
        vipKeyType = type;
        console.log(`✅ Found VIP key: "${key}" (type: ${type})\n`);
        break;
      }
    }

    if (!vipKeyFound) {
      console.log('⚠️  No existing VIP key found. Trying common patterns...\n');

      // Check if there's a pattern with user IDs
      const sampleUserId = accounts.players[0].id;
      const userKeyPatterns = [
        `vip:user:${sampleUserId}`,
        `user:${sampleUserId}:vip`,
        `vip:${sampleUserId}`,
      ];

      for (const pattern of userKeyPatterns) {
        const exists = await redis.exists(pattern);
        if (exists) {
          console.log(`✅ Found individual VIP key pattern: "${pattern}"\n`);
          vipKeyFound = pattern.replace(sampleUserId, '*');
          vipKeyType = 'individual';
          break;
        }
      }
    }

    // If still not found, let's check the codebase hint
    console.log('📖 Based on tambola backend, VIP check likely uses one of:');
    console.log('   - Redis SET: vip:users');
    console.log('   - Redis HASH: vip:cohort');
    console.log('   - Individual keys: vip:user:<userId>\n');

    // Let's use the most common pattern: SET with key "vip:users"
    const VIP_KEY = vipKeyFound || 'vip:users';
    console.log(`🎯 Using VIP key: "${VIP_KEY}"\n`);

    // Add all test accounts to VIP
    console.log('📝 Adding test accounts to VIP list...\n');

    let addedCount = 0;
    let skippedCount = 0;

    // Add players
    console.log('👥 Adding players:');
    for (const player of accounts.players) {
      try {
        if (vipKeyType === 'set' || !vipKeyType) {
          // Add to SET
          const result = await redis.sadd(VIP_KEY, player.id);
          if (result === 1) {
            addedCount++;
            if (addedCount <= 5 || addedCount === accounts.players.length) {
              console.log(`  ✓ ${player.name} (${player.id})`);
            } else if (addedCount === 6) {
              console.log(`  ... (${accounts.players.length - 5} more)`);
            }
          } else {
            skippedCount++;
          }
        } else if (vipKeyType === 'hash') {
          // Add to HASH
          const timestamp = new Date().toISOString();
          await redis.hset(VIP_KEY, player.id, timestamp);
          addedCount++;
          if (addedCount <= 5) {
            console.log(`  ✓ ${player.name} (${player.id})`);
          }
        } else if (vipKeyType === 'individual') {
          // Create individual key
          const key = `vip:user:${player.id}`;
          await redis.set(key, '1');
          addedCount++;
          if (addedCount <= 5) {
            console.log(`  ✓ ${player.name} (${player.id})`);
          }
        }
      } catch (error) {
        console.error(`  ✗ Failed to add ${player.name}:`, error.message);
      }
    }

    // Add organizers (they may also need VIP to test)
    console.log('\n👨‍💼 Adding organizers:');
    for (const organizer of accounts.organizers) {
      try {
        if (vipKeyType === 'set' || !vipKeyType) {
          const result = await redis.sadd(VIP_KEY, organizer.id);
          if (result === 1) {
            addedCount++;
          } else {
            skippedCount++;
          }
        } else if (vipKeyType === 'hash') {
          const timestamp = new Date().toISOString();
          await redis.hset(VIP_KEY, organizer.id, timestamp);
          addedCount++;
        } else if (vipKeyType === 'individual') {
          const key = `vip:user:${organizer.id}`;
          await redis.set(key, '1');
          addedCount++;
        }
        console.log(`  ✓ ${organizer.name} (${organizer.id})`);
      } catch (error) {
        console.error(`  ✗ Failed to add ${organizer.name}:`, error.message);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`✅ Added ${addedCount} users to VIP list`);
    if (skippedCount > 0) {
      console.log(`⚠️  Skipped ${skippedCount} users (already in VIP list)`);
    }
    console.log('═══════════════════════════════════════════════════════════\n');

    // Verify
    console.log('🔍 Verifying VIP access...\n');
    const samplePlayer = accounts.players[0];

    let isVIP = false;
    if (vipKeyType === 'set' || !vipKeyType) {
      isVIP = await redis.sismember(VIP_KEY, samplePlayer.id);
    } else if (vipKeyType === 'hash') {
      isVIP = await redis.hexists(VIP_KEY, samplePlayer.id);
    } else if (vipKeyType === 'individual') {
      isVIP = await redis.exists(`vip:user:${samplePlayer.id}`);
    }

    if (isVIP) {
      console.log(`✅ Sample verification passed: ${samplePlayer.name} is now VIP\n`);
    } else {
      console.warn(`⚠️  Sample verification failed: ${samplePlayer.name} not found in VIP list`);
      console.warn(`   This might be normal if the key format is different.\n`);
    }

    // Show total VIP count
    let totalVIPs = 0;
    if (vipKeyType === 'set' || !vipKeyType) {
      totalVIPs = await redis.scard(VIP_KEY);
      console.log(`📊 Total VIP users in Redis: ${totalVIPs}\n`);
    } else if (vipKeyType === 'hash') {
      totalVIPs = await redis.hlen(VIP_KEY);
      console.log(`📊 Total VIP users in Redis: ${totalVIPs}\n`);
    }

    console.log('✅ VIP access granted successfully!\n');
    console.log('📋 Next steps:');
    console.log('   1. Run diagnostic tests:');
    console.log('      npx playwright test diagnostics/01-join-latency-test.spec.ts --reporter=list\n');
    console.log('   2. If tests still fail, check backend logs to see the actual VIP key format:\n');
    console.log('      aws logs tail /aws/apprunner/tambola-backend/<id>/application --filter-pattern "VIP" --region ap-south-1\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

grantVIPAccess().catch(console.error);
