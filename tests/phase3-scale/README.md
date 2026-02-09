# Phase 3 Scale Testing Suite

Comprehensive testing infrastructure for validating Tambola game at 50 concurrent user scale.

## Overview

This test suite validates:
- ✅ Core gameplay with 50 concurrent users
- ✅ State persistence under various failure modes
- ✅ Win claim race conditions
- ✅ Organizer operations at scale
- ✅ Browser-specific edge cases
- ✅ Network disruption handling

## Test Infrastructure

### Architecture
- **Socket Players**: Lightweight Socket.IO clients for performance testing and event monitoring
- **Browser Players**: Playwright automation for full UI validation
- **Organizer Control**: Hybrid socket + browser control for game management
- **Metrics Collection**: Real-time performance metrics (latency, errors, custom metrics)

### Test Categories

1. **Baseline Gameplay** (Tests 1-2)
   - Full game flow with 50 players
   - Rapid concurrent joins (stress test)

2. **State Persistence** (Tests 3-4)
   - Concurrent hard refresh (10 players)
   - Hard refresh after winning

3. **Leave/Rejoin** (Tests 5-6)
   - Mass leave/rejoin (20 players)
   - Leave during win claim

4. **Network Disruption** (Tests 7-8)
   - Brief network blip (15 players)
   - Long network outage (5 players)

5. **Win Race Conditions** (Tests 9-10)
   - Early 5 race (5 players)
   - Full House race (3 players)

6. **Browser Specific** (Tests 11-12)
   - Multiple tabs same player
   - Browser back button

7. **Organizer Operations** (Tests 13-14)
   - Organizer hard refresh
   - Rapid number calling

## Setup

### Prerequisites
```bash
# Install dependencies
npm install @playwright/test socket.io-client

# Install Playwright browsers
npx playwright install chromium
```

### Environment Variables
```bash
export BACKEND_URL="https://jurpkxvw5m.ap-south-1.awsapprunner.com"
export FRONTEND_URL="https://main.d262mxsv2xemak.amplifyapp.com"
```

### Create Test Accounts

**IMPORTANT**: Run this ONCE before first test execution:

```bash
cd tests/phase3-scale
node setup/create-test-accounts.mjs
```

This creates:
- 50 player accounts: `test-player-01@tambola.test` through `test-player-50@tambola.test`
- 5 organizer accounts: `test-org-01@tambola.test` through `test-org-05@tambola.test`
- Password for all: `TestPass@123`

Accounts are saved to `setup/test-accounts.json` and reused across test runs.

## Running Tests

### Run All Tests
```bash
cd tests/phase3-scale
node run-all.mjs
```

Executes all 14 test scenarios sequentially. Estimated time: ~2 hours.

### Run Individual Test
```bash
cd tests/phase3-scale
npx playwright test scenarios/01-baseline-50-players.spec.ts
```

### Run Specific Category
```bash
# State persistence tests
npx playwright test scenarios/03-concurrent-hard-refresh.spec.ts
npx playwright test scenarios/04-hard-refresh-after-win.spec.ts

# Win race tests
npx playwright test scenarios/09-early-5-race.spec.ts
npx playwright test scenarios/10-full-house-race.spec.ts
```

## Test Results

### Console Output
Tests provide real-time console output with:
- Progress indicators (step-by-step execution)
- Validation checkpoints (✅/❌)
- Performance metrics (latency, duration)
- Final summary (pass/fail status)

### JSON Results
After test completion:
```bash
cat tests/phase3-scale/test-results.json
```

Contains:
- Timestamp
- Total/passed/failed/skipped counts
- Individual test results with durations
- Error details for failed tests

### Example Output
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
```

## Cleanup

### After Tests
```bash
cd tests/phase3-scale
node setup/cleanup.mjs
```

This deletes all test games created during test execution. Test accounts remain in the database for reuse.

### Full Reset (Delete Accounts)
If you need to regenerate test accounts:
```bash
# Delete accounts manually via database
# Then regenerate:
node setup/create-test-accounts.mjs
```

## Test Implementation Status

| Test ID | Scenario | Status | File |
|---------|----------|--------|------|
| 1 | Baseline: 50 Player Game Flow | ✅ Implemented | 01-baseline-50-players.spec.ts |
| 2 | Rapid Player Joins | ⏳ TODO | 02-rapid-joins.spec.ts |
| 3 | Concurrent Hard Refresh | ✅ Implemented | 03-concurrent-hard-refresh.spec.ts |
| 4 | Hard Refresh After Win | ⏳ TODO | 04-hard-refresh-after-win.spec.ts |
| 5 | Mass Leave/Rejoin | ✅ Implemented | 05-mass-leave-rejoin.spec.ts |
| 6 | Leave During Win Claim | ⏳ TODO | 06-leave-during-win-claim.spec.ts |
| 7 | Network Blip (15 Players) | ⏳ TODO | 07-network-blip-15-players.spec.ts |
| 8 | Long Network Outage | ⏳ TODO | 08-long-outage-5-players.spec.ts |
| 9 | Early 5 Race | ✅ Implemented | 09-early-5-race.spec.ts |
| 10 | Full House Race | ⏳ TODO | 10-full-house-race.spec.ts |
| 11 | Multiple Tabs | ⏳ TODO | 11-multiple-tabs-same-player.spec.ts |
| 12 | Browser Back Button | ⏳ TODO | 12-browser-back-button.spec.ts |
| 13 | Organizer Hard Refresh | ⏳ TODO | 13-organizer-hard-refresh.spec.ts |
| 14 | Rapid Number Calling | ⏳ TODO | 14-rapid-number-calling.spec.ts |

## Helper Classes

### SocketPlayer
Lightweight Socket.IO client for performance testing:
```typescript
import { SocketPlayer } from './helpers/socket-player';

const player = new SocketPlayer({
  account: { id, name, email, password, token },
  backendUrl: 'https://backend.example.com',
  debug: false,
});

await player.connect();
await player.joinGame(gameId);
player.enableAutoMark(); // Auto-mark numbers as called
player.markNumber(42);
await player.claimWin('EARLY_5');
```

### BrowserPlayer
Playwright automation for UI validation:
```typescript
import { BrowserPlayer } from './helpers/browser-player';

const player = new BrowserPlayer({
  browser,
  account: { id, name, email, password, token },
  frontendUrl: 'https://frontend.example.com',
  debug: false,
});

await player.init();
await player.navigateToGame(gameId);
await player.markNumber(42);
await player.claimWin('EARLY_5');
await player.hardRefresh();
```

### Organizer
Hybrid socket + browser control:
```typescript
import { Organizer } from './helpers/organizer';

const organizer = new Organizer({
  browser,
  account: { id, name, email, password, token },
  backendUrl: 'https://backend.example.com',
  frontendUrl: 'https://frontend.example.com',
  debug: false,
});

await organizer.connect();
const gameId = await organizer.createGame();
await organizer.joinGame(gameId);
await organizer.startGame();
await organizer.callNumber(42);
await organizer.callRandomNumbers(75, 1000);
```

### MetricsCollector
Performance metrics:
```typescript
import { MetricsCollector } from './helpers/metrics';

const metrics = new MetricsCollector();
metrics.recordLatency(125, 'player-123');
metrics.recordError('Connection timeout', { playerId: 'player-123' });

const stats = metrics.getLatencyStats();
console.log(`P90 latency: ${stats.p90}ms`);
```

### Validators
Common assertions:
```typescript
import { Validators } from './helpers/validators';

// Validate event broadcast
Validators.validateEventBroadcast(
  players,
  (p) => p.calledNumbers.length === 50,
  'All 50 numbers received'
);

// Validate unique tickets
Validators.validateUniqueTickets(players);

// Validate player state
Validators.validatePlayerState(player, {
  markedCount: 15,
  calledCount: 50,
  winnersCount: 3,
});

// Validate exclusive winner (Early 5, Full House)
Validators.validateExclusiveWinner(players, 'EARLY_5');
```

## Performance Targets

| Metric | Target | Validated By |
|--------|--------|--------------|
| Event broadcast latency (P90) | < 500ms | All tests |
| Player join time | < 3s | Test 1, 2 |
| State sync latency | < 500ms | Test 3-8 |
| Win claim processing | < 1s | Test 9-10 |
| Hard refresh recovery | < 3s | Test 3-4, 13 |
| Concurrent operations | 50 players | All tests |

## Troubleshooting

### Test accounts not found
```
❌ ERROR: Test accounts not found!
   Run: node setup/create-test-accounts.mjs
```
**Solution**: Create test accounts as shown above.

### Connection timeout
```
Connection timeout after 10000ms
```
**Solution**:
1. Verify BACKEND_URL is correct
2. Check backend is running and accessible
3. Verify test account credentials are valid

### Playwright not installed
```
Error: browserType.launch: Executable doesn't exist
```
**Solution**: `npx playwright install chromium`

### Port already in use (running locally)
**Solution**: Stop other instances or change ports in environment variables.

## Contributing

When adding new test scenarios:

1. Create new spec file in `scenarios/` following naming convention
2. Use helper classes (SocketPlayer, BrowserPlayer, Organizer)
3. Include metrics collection and validation
4. Add scenario to `SCENARIOS` array in `run-all.mjs`
5. Update README with test details

## License

Internal testing infrastructure for Tambola game project.
# Deployment trigger - Socket.IO fix ready
