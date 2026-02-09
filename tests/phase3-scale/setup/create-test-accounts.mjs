#!/usr/bin/env node
/**
 * Pre-generate 50 player accounts and 5 organizer accounts for Phase 3 testing
 * Accounts are stored in test-accounts.json for reuse across test scenarios
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';
const API_URL = `${BACKEND_URL}/api/v1`;

const PLAYER_COUNT = 50;
const ORGANIZER_COUNT = 5;

async function apiRequest(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_URL}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return await response.json();
}

async function createAccount(name, email, password, role) {
  try {
    const result = await apiRequest('POST', '/auth/signup', { name, email, password, role });
    return {
      id: result.user.id,
      name,
      email,
      password,
      role,
      token: result.token,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    // If account already exists, try to login
    if (error.message.includes('already exists') || error.message.includes('409')) {
      try {
        const loginResult = await apiRequest('POST', '/auth/login', { email, password });
        return {
          id: loginResult.user.id,
          name,
          email,
          password,
          role,
          token: loginResult.token,
          createdAt: new Date().toISOString(),
          note: 'Already existed, logged in',
        };
      } catch (loginError) {
        throw new Error(`Failed to create or login: ${loginError.message}`);
      }
    }
    throw error;
  }
}

async function createTestAccounts() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║       PHASE 3 TEST ACCOUNT GENERATION                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Backend URL: ${BACKEND_URL}\n`);

  const accounts = {
    players: [],
    organizers: [],
    metadata: {
      createdAt: new Date().toISOString(),
      backendUrl: BACKEND_URL,
      playerCount: PLAYER_COUNT,
      organizerCount: ORGANIZER_COUNT,
    },
  };

  // Create players
  console.log(`Creating ${PLAYER_COUNT} player accounts...`);
  for (let i = 1; i <= PLAYER_COUNT; i++) {
    const paddedNum = String(i).padStart(2, '0');
    const name = `TestPlayer${paddedNum}`;
    const email = `test-player-${paddedNum}@tambola.test`;
    const password = 'TestPass@123';

    try {
      const account = await createAccount(name, email, password, 'PLAYER');
      accounts.players.push(account);
      process.stdout.write(`\r  ✅ Created: ${i}/${PLAYER_COUNT} players`);
    } catch (error) {
      console.error(`\n  ❌ Failed to create ${email}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log('\n');

  // Create organizers
  console.log(`Creating ${ORGANIZER_COUNT} organizer accounts...`);
  for (let i = 1; i <= ORGANIZER_COUNT; i++) {
    const paddedNum = String(i).padStart(2, '0');
    const name = `TestOrganizer${paddedNum}`;
    const email = `test-org-${paddedNum}@tambola.test`;
    const password = 'TestPass@123';

    try {
      const account = await createAccount(name, email, password, 'ORGANIZER');
      accounts.organizers.push(account);
      process.stdout.write(`\r  ✅ Created: ${i}/${ORGANIZER_COUNT} organizers`);
    } catch (error) {
      console.error(`\n  ❌ Failed to create ${email}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log('\n');

  // Save to file
  const outputPath = path.join(__dirname, 'test-accounts.json');
  fs.writeFileSync(outputPath, JSON.stringify(accounts, null, 2));

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Players created: ${accounts.players.length}`);
  console.log(`  ✅ Organizers created: ${accounts.organizers.length}`);
  console.log(`  📁 Saved to: ${outputPath}\n`);
  console.log('  Sample credentials:');
  console.log(`    Player: ${accounts.players[0].email} / TestPass@123`);
  console.log(`    Organizer: ${accounts.organizers[0].email} / TestPass@123\n`);
}

createTestAccounts().catch((error) => {
  console.error('\n❌ Account generation failed:', error);
  process.exit(1);
});
