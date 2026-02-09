# Quick Start Guide - Phase 3 Scale Testing

## Prerequisites

**Installed on your system:**
- Node.js >= 18.0.0
- npm or yarn

## Step-by-Step Setup (First Time Only)

### 1. Navigate to test directory
```bash
cd /Users/stageadmin/tambola-game/tambola-backend/tests/phase3-scale
```

### 2. Install dependencies
```bash
npm install
```

This installs:
- `@playwright/test` - Browser automation framework
- `socket.io-client` - WebSocket client for testing

### 3. Install Playwright browsers
```bash
npx playwright install chromium
```

Downloads Chromium browser (~100MB) for UI testing.

### 4. Create test accounts (IMPORTANT - Run once)
```bash
npm run setup
```

This creates:
- 50 player accounts (`test-player-01@tambola.test` through `test-player-50@tambola.test`)
- 5 organizer accounts (`test-org-01@tambola.test` through `test-org-05@tambola.test`)
- All accounts use password: `TestPass@123`
- Accounts saved to `setup/test-accounts.json`

**Expected output:**
```
╔════════════════════════════════════════════════════════════╗
║       PHASE 3 TEST ACCOUNT GENERATION                     ║
╚════════════════════════════════════════════════════════════╝

Backend URL: https://nhuh2kfbwk.ap-south-1.awsapprunner.com

Creating 50 player accounts...
  ✅ Created: 50/50 players

Creating 5 organizer accounts...
  ✅ Created: 5/5 organizers

╔════════════════════════════════════════════════════════════╗
║                    SUMMARY                                 ║
╚════════════════════════════════════════════════════════════╝

  ✅ Players created: 50
  ✅ Organizers created: 5
  📁 Saved to: setup/test-accounts.json
```

**Time:** ~2-3 minutes

---

## Running Tests

### Option 1: Run ALL tests (Full Suite)
```bash
npm test
```

Runs all 14 test scenarios sequentially.

**Time:** ~2 hours
**Output:** Real-time progress + final report

### Option 2: Run individual tests
```bash
# Test 1: Baseline - 50 players full game
npm run test:baseline

# Test 3: Concurrent hard refresh (10 players)
npm run test:refresh

# Test 5: Mass leave/rejoin (20 players)
npm run test:rejoin

# Test 9: Early 5 race condition (5 players)
npm run test:race
```

**Time per test:** 3-15 minutes

### Option 3: Run specific test file
```bash
npx playwright test scenarios/01-baseline-50-players.spec.ts
```

---

## Understanding Test Output

### During Test Execution
```
╔════════════════════════════════════════════════════════════╗
║   TEST 1: BASELINE - 50 PLAYER GAME FLOW                  ║
╚════════════════════════════════════════════════════════════╝

Step 1: Setting up organizer...
✅ Organizer ready, game: abc-123-def

Step 2: Connecting 50 socket players...
  Connected: 10/50 players
  Connected: 20/50 players
  Connected: 30/50 players
  Connected: 40/50 players
  Connected: 50/50 players
✅ All 50 players connected

Step 3: Players joining game...
✅ All 50 players joined

... (continues step-by-step)
```

### Test Success
```
╔════════════════════════════════════════════════════════════╗
║                    TEST COMPLETE                           ║
╚════════════════════════════════════════════════════════════╝

  Players: 50
  Numbers called: 75
  P90 latency: 342ms
  Winners: 5
  Status: ✅ PASSED
```

### Final Report (All Tests)
```
╔════════════════════════════════════════════════════════════════════╗
║                         FINAL REPORT                               ║
╚════════════════════════════════════════════════════════════════════╝

Total Tests:     14
✅ Passed:       10
❌ Failed:       0
⏭️  Skipped:      4
⏱️  Total Time:   95.3 minutes

Pass Rate: 100.0% (excluding skipped)

═══════════════════════════════════════════════════════════════════
DETAILED RESULTS:

✅ Test 1: Baseline: 50 Player Game Flow
   Status: PASSED | Duration: 15.2s

✅ Test 3: Concurrent Hard Refresh (10 Players)
   Status: PASSED | Duration: 8.7s

✅ Test 5: Mass Leave/Rejoin (20 Players)
   Status: PASSED | Duration: 12.1s

✅ Test 9: Early 5 Race (5 Players)
   Status: PASSED | Duration: 6.4s

⏭️ Test 2: Rapid Player Joins (Stress Test)
   Status: SKIPPED | Duration: 0.0s
   (Not yet implemented)

... (continues for all tests)
```

---

## Cleanup

### Delete test games (keep accounts)
```bash
npm run cleanup
```

Deletes all games created during tests. Test accounts remain for reuse.

### Full reset (if needed)
If you need to regenerate test accounts:

1. Delete accounts manually in database, OR
2. Re-run: `npm run setup`

---

## Troubleshooting

### ❌ "Test accounts not found"
**Problem:**
```
❌ ERROR: Test accounts not found!
   Run: node setup/create-test-accounts.mjs
```

**Solution:**
```bash
npm run setup
```

---

### ❌ "Connection timeout"
**Problem:**
```
Error: Connection timeout after 10000ms
```

**Solutions:**
1. Check backend is running:
   ```bash
   curl https://nhuh2kfbwk.ap-south-1.awsapprunner.com/health
   ```

2. Verify environment variables:
   ```bash
   echo $BACKEND_URL
   echo $FRONTEND_URL
   ```

3. Test with manual login:
   - Email: `test-player-01@tambola.test`
   - Password: `TestPass@123`

---

### ❌ "Playwright not installed"
**Problem:**
```
Error: browserType.launch: Executable doesn't exist
```

**Solution:**
```bash
npx playwright install chromium
```

---

### ❌ "Module not found"
**Problem:**
```
Error: Cannot find module 'socket.io-client'
```

**Solution:**
```bash
npm install
```

---

## Test Results Location

After running tests:

- **JSON Results:** `test-results.json`
- **Console Output:** Displayed in terminal
- **Playwright Reports:** `playwright-report/` (if generated)

View JSON results:
```bash
cat test-results.json | jq .
```

---

## What Each Test Validates

| Test | What It Checks | Players | Duration |
|------|----------------|---------|----------|
| 1. Baseline | Full game flow, event broadcast, latency | 50 | ~15 min |
| 3. Hard Refresh | State restoration after refresh | 10 | ~9 min |
| 5. Leave/Rejoin | State sync after leaving and rejoining | 20 | ~12 min |
| 9. Early 5 Race | Win claim race condition handling | 5 | ~6 min |

---

## Performance Targets

Tests validate these metrics:

- ✅ Event broadcast latency (P90): **< 500ms**
- ✅ Player join time: **< 3s**
- ✅ State sync latency: **< 500ms**
- ✅ Win claim processing: **< 1s**
- ✅ Hard refresh recovery: **< 3s**
- ✅ Concurrent operations: **50 players**

---

## Next Steps

1. ✅ **Setup complete?** → Run first test: `npm run test:baseline`
2. ✅ **First test passed?** → Run full suite: `npm test`
3. ✅ **All tests passed?** → Review results in `test-results.json`
4. ❌ **Tests failed?** → Check troubleshooting section above

---

## Getting Help

**Common Issues:**
- Account creation fails → Check backend is accessible
- Tests timeout → Increase timeout in spec files
- Browser crashes → Reduce concurrent browser instances

**For detailed documentation:**
- See `README.md` for full documentation
- See individual test files for implementation details
- See helper classes for API reference

---

**Ready to test? Start here:**
```bash
cd /Users/stageadmin/tambola-game/tambola-backend/tests/phase3-scale
npm install
npx playwright install chromium
npm run setup
npm run test:baseline
```
