#!/usr/bin/env node
/**
 * Master Test Runner for Phase 3 Scale Testing
 * Executes all 14 test scenarios sequentially and generates comprehensive report
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCENARIOS = [
  { id: 1, file: '01-baseline-50-players.spec.ts', name: 'Baseline: 200 Player Game Flow', enabled: true },
  { id: 2, file: '02-rapid-joins.spec.ts', name: 'Rapid Player Joins (Stress Test)', enabled: false }, // TODO: Create
  { id: 3, file: '03-concurrent-hard-refresh.spec.ts', name: 'Concurrent Hard Refresh (10 Players)', enabled: true },
  { id: 4, file: '04-hard-refresh-after-win.spec.ts', name: 'Hard Refresh After Winning', enabled: false }, // TODO: Create
  { id: 5, file: '05-mass-leave-rejoin.spec.ts', name: 'Mass Leave/Rejoin (80 of 200 Players)', enabled: true },
  { id: 6, file: '06-leave-during-win-claim.spec.ts', name: 'Leave During Win Claim', enabled: false }, // TODO: Create
  { id: 7, file: '07-network-blip-15-players.spec.ts', name: 'Network Blip (15 Players)', enabled: false }, // TODO: Create
  { id: 8, file: '08-long-outage-5-players.spec.ts', name: 'Long Network Outage (5 Players)', enabled: false }, // TODO: Create
  { id: 9, file: '09-early-5-race.spec.ts', name: 'Early 5 Race (5 of 200 Players)', enabled: true },
  { id: 10, file: '10-full-house-race-3-players.spec.ts', name: 'Full House Race (3 Players)', enabled: false }, // TODO: Create
  { id: 11, file: '11-multiple-tabs-same-player.spec.ts', name: 'Multiple Tabs Same Player', enabled: false }, // TODO: Create
  { id: 12, file: '12-browser-back-button.spec.ts', name: 'Browser Back Button', enabled: false }, // TODO: Create
  { id: 13, file: '13-organizer-hard-refresh.spec.ts', name: 'Organizer Hard Refresh', enabled: false }, // TODO: Create
  { id: 14, file: '14-rapid-number-calling.spec.ts', name: 'Rapid Number Calling', enabled: false }, // TODO: Create
];

const results = [];
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;

async function runScenario(scenario) {
  if (!scenario.enabled) {
    console.log(`\n⏭️  Skipping Test ${scenario.id}: ${scenario.name} (not yet implemented)\n`);
    skippedTests++;
    return {
      ...scenario,
      status: 'SKIPPED',
      duration: 0,
      error: null,
    };
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧪 Running Test ${scenario.id}: ${scenario.name}`);
  console.log('='.repeat(70));

  const startTime = Date.now();

  return new Promise((resolve) => {
    const scenarioPath = path.join(__dirname, 'scenarios', scenario.file);

    const proc = spawn('npx', ['playwright', 'test', scenarioPath], {
      cwd: __dirname,
      stdio: 'inherit',
      env: {
        ...process.env,
        BACKEND_URL: process.env.BACKEND_URL || 'https://nhuh2kfbwk.ap-south-1.awsapprunner.com',
        FRONTEND_URL: process.env.FRONTEND_URL || 'https://main.d262mxsv2xemak.amplifyapp.com',
      },
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      const durationSec = (duration / 1000).toFixed(1);

      if (code === 0) {
        console.log(`\n✅ Test ${scenario.id} PASSED (${durationSec}s)\n`);
        passedTests++;
        resolve({
          ...scenario,
          status: 'PASSED',
          duration,
          error: null,
        });
      } else {
        console.log(`\n❌ Test ${scenario.id} FAILED (${durationSec}s)\n`);
        failedTests++;
        resolve({
          ...scenario,
          status: 'FAILED',
          duration,
          error: `Exit code: ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      const duration = Date.now() - startTime;
      console.log(`\n❌ Test ${scenario.id} ERROR: ${error.message}\n`);
      failedTests++;
      resolve({
        ...scenario,
        status: 'ERROR',
        duration,
        error: error.message,
      });
    });
  });
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║            PHASE 3 SCALE TESTING - FULL TEST SUITE                ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  // Check prerequisites
  console.log('Checking prerequisites...');

  const accountsPath = path.join(__dirname, 'setup/test-accounts.json');
  if (!fs.existsSync(accountsPath)) {
    console.error('\n❌ ERROR: Test accounts not found!');
    console.error('   Run: node setup/create-test-accounts.mjs\n');
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  console.log(`✅ Test accounts loaded: ${accounts.players.length} players, ${accounts.organizers.length} organizers\n`);

  // Run all scenarios
  for (let i = 0; i < SCENARIOS.length; i++) {
    const scenario = SCENARIOS[i];
    totalTests++;
    const result = await runScenario(scenario);
    results.push(result);

    // Add 30-second cooldown between tests to allow backend recovery
    if (i < SCENARIOS.length - 1 && result.status !== 'SKIPPED') {
      console.log('\n⏳ Waiting 30 seconds for backend to stabilize...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  const totalDuration = Date.now() - startTime;
  const totalDurationMin = (totalDuration / 1000 / 60).toFixed(1);

  // Generate report
  generateReport(totalDurationMin);

  // Save results
  const resultsPath = path.join(__dirname, 'test-results.json');
  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalTests,
        passedTests,
        failedTests,
        skippedTests,
        totalDurationMs: totalDuration,
        results,
      },
      null,
      2
    )
  );

  console.log(`\n📄 Full results saved to: ${resultsPath}\n`);

  // Exit with appropriate code
  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function generateReport(totalDurationMin) {
  console.log('\n\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         FINAL REPORT                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total Tests:     ${totalTests}`);
  console.log(`✅ Passed:       ${passedTests}`);
  console.log(`❌ Failed:       ${failedTests}`);
  console.log(`⏭️  Skipped:      ${skippedTests}`);
  console.log(`⏱️  Total Time:   ${totalDurationMin} minutes\n`);

  const passRate = totalTests > 0 ? ((passedTests / (totalTests - skippedTests)) * 100).toFixed(1) : 0;
  console.log(`Pass Rate: ${passRate}% (excluding skipped)\n`);

  console.log('═'.repeat(70));
  console.log('DETAILED RESULTS:\n');

  results.forEach((result) => {
    const statusEmoji = result.status === 'PASSED' ? '✅' : result.status === 'FAILED' ? '❌' : '⏭️';
    const durationSec = (result.duration / 1000).toFixed(1);

    console.log(`${statusEmoji} Test ${result.id}: ${result.name}`);
    console.log(`   Status: ${result.status} | Duration: ${durationSec}s`);

    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }

    console.log('');
  });

  console.log('═'.repeat(70));

  if (failedTests > 0) {
    console.log('\n⚠️  SOME TESTS FAILED - Review logs above for details\n');
  } else if (passedTests === totalTests - skippedTests) {
    console.log('\n🎉 ALL TESTS PASSED! Phase 3 scale testing complete.\n');
  } else {
    console.log('\n✅ All enabled tests passed. Skipped tests need implementation.\n');
  }
}

// Run all tests
runAllTests().catch((error) => {
  console.error('\n❌ Test runner crashed:', error);
  process.exit(1);
});
