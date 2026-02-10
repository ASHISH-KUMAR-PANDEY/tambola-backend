# Tambola Tests - Quick Reference Card

## One-Click Commands

```bash
# Navigate to test directory (run this first)
cd /Users/stageadmin/tambola-game/tambola-backend/tests/phase3-scale

# ONE-TIME SETUP (required before first run)
npm install
npx playwright install chromium
node setup/create-test-accounts.mjs

# RUN ALL TESTS (Phase 1 + 2 + 3)
npm run test:all                    # ~5-8 minutes

# INDIVIDUAL PHASES
npm run test:baseline               # Phase 1: 50-player baseline (~2 min)
npm run test:persistence            # Phase 2: Hard refresh (~2 min)
npm run test:extreme                # Phase 3: Leave/rejoin + race (~3 min)

# INDIVIDUAL TESTS
npm run test:baseline               # Test 1: 50 players, 75 numbers
npm run test:refresh                # Test 3: 10 concurrent refreshes
npm run test:rejoin                 # Test 5: 20 leave/rejoin
npm run test:race                   # Test 9: 5 simultaneous claims

# CLEANUP
node setup/cleanup.mjs              # Delete test games
```

---

## System Status Check

```bash
# Backend health
curl https://nhuh2kfbwk.ap-south-1.awsapprunner.com/health

# Expected: {"status":"ok","timestamp":"..."}
```

---

## Test Results Location

- **Console:** Real-time output with ✅/❌ indicators
- **HTML Report:** `npx playwright show-report`
- **Traces:** `test-results/*/trace.zip`

---

## Common Issues

| Issue | Solution |
|-------|----------|
| "Test accounts not found" | Run: `node setup/create-test-accounts.mjs` |
| "Connection timeout" | Check backend: `curl <backend-url>/health` |
| "Playwright not installed" | Run: `npx playwright install chromium` |
| All tests failing | Regenerate accounts: `node setup/create-test-accounts.mjs` |

---

## Test Credentials

- **Players:** `test-player-01@tambola.test` through `test-player-50@tambola.test`
- **Organizers:** `test-org-01@tambola.test` through `test-org-05@tambola.test`
- **Password:** `TestPass@123` (all accounts)

---

## Production URLs

- **Backend:** https://nhuh2kfbwk.ap-south-1.awsapprunner.com
- **Frontend:** https://main.d262mxsv2xemak.amplifyapp.com

---

## Test Coverage

| Test | Players | What It Tests | Duration |
|------|---------|---------------|----------|
| **1** | 50 | Full game flow, 75 numbers, multiple wins | 2 min |
| **3** | 50 | 10 hard refresh during active game | 2 min |
| **5** | 50 | 20 leave/rejoin during active game | 1.5 min |
| **9** | 50 | 5 simultaneous Early 5 claims | 45 sec |

**Total:** All 4 tests in ~5-8 minutes

---

## File Structure

```
tests/phase3-scale/
├── TEST-EXECUTION-GUIDE.md     ← Full documentation
├── QUICK-REFERENCE.md           ← This file
├── package.json                 ← NPM scripts
├── scenarios/                   ← Test files
│   ├── 01-baseline-50-players.spec.ts
│   ├── 03-concurrent-hard-refresh.spec.ts
│   ├── 05-mass-leave-rejoin.spec.ts
│   └── 09-early-5-race.spec.ts
├── setup/
│   ├── create-test-accounts.mjs ← Account creation
│   ├── cleanup.mjs              ← Delete test games
│   └── test-accounts.json       ← Generated accounts
└── helpers/                     ← Test utilities
```

---

**Need more details?** See `TEST-EXECUTION-GUIDE.md`

**Last Updated:** 2026-02-10
