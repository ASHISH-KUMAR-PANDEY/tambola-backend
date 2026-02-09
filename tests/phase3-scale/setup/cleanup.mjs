#!/usr/bin/env node
/**
 * Cleanup script to delete test games and accounts
 * Run after test suite completion
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKEND_URL = process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com';
const API_URL = `${BACKEND_URL}/api/v1`;

async function apiRequest(method, path, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };

  const response = await fetch(`${API_URL}${path}`, options);
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    console.warn(`  ⚠️  Warning: ${method} ${path} failed: ${response.status}`);
  }
  return response.ok;
}

async function cleanup() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║       PHASE 3 TEST CLEANUP                                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Load test accounts
  const accountsPath = path.join(__dirname, 'test-accounts.json');
  if (!fs.existsSync(accountsPath)) {
    console.log('  ℹ️  No test accounts file found. Nothing to clean up.\n');
    return;
  }

  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));

  // Delete games created by organizers
  console.log('Deleting test games...');
  let gamesDeleted = 0;
  for (const organizer of accounts.organizers) {
    try {
      // Get all games for this organizer
      const gamesResponse = await fetch(`${API_URL}/games`, {
        headers: { Authorization: `Bearer ${organizer.token}` },
      });

      if (gamesResponse.ok) {
        const games = await gamesResponse.json();
        for (const game of games) {
          const deleted = await apiRequest('DELETE', `/games/${game.id}`, organizer.token);
          if (deleted) gamesDeleted++;
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Could not delete games for ${organizer.email}`);
    }
  }
  console.log(`  ✅ Deleted ${gamesDeleted} test games\n`);

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    CLEANUP COMPLETE                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`  ✅ Test games deleted: ${gamesDeleted}`);
  console.log(`  ℹ️  Test accounts remain in database (can be reused)\n`);
}

cleanup().catch((error) => {
  console.error('\n❌ Cleanup failed:', error);
  process.exit(1);
});
