# Implementation Checklist: Enable WebSocket for 20+ Player Games

## Pre-Implementation

- [ ] Read `DEV-ISSUE-REPORT.md` for full context
- [ ] Verify current Socket.IO version (should be v4.x+)
- [ ] Check current `transports` configuration in codebase
- [ ] Confirm AWS App Runner supports WebSocket

## Backend Changes

- [ ] Locate Socket.IO server initialization (likely `src/app.ts` or `src/websocket/`)
- [ ] Add `'websocket'` to `transports` array
  ```typescript
  transports: ['websocket', 'polling']
  ```
- [ ] Add `allowUpgrades: true` if not present
- [ ] Set reasonable ping timeouts:
  ```typescript
  pingTimeout: 60000,
  pingInterval: 25000,
  ```
- [ ] Commit changes to feature branch

## Frontend Changes

- [ ] Locate Socket.IO client initialization
- [ ] Add `'websocket'` to `transports` array
  ```typescript
  transports: ['websocket', 'polling']
  ```
- [ ] Add `upgrade: true` if not present
- [ ] Commit changes to feature branch

## AWS App Runner Verification

- [ ] Run command to check App Runner config:
  ```bash
  aws apprunner describe-service \
    --service-arn <arn> \
    --region ap-south-1
  ```
- [ ] Confirm WebSocket is not explicitly disabled
- [ ] Check security groups allow WebSocket connections (port 443 for wss://)

## Local Testing

- [ ] Start backend locally
- [ ] Start frontend locally
- [ ] Open browser DevTools → Network tab
- [ ] Connect to game
- [ ] Verify connection type is "websocket" (not "polling")
  - Look for `ws://` or `wss://` connection in Network tab
  - Check Socket.IO debug logs: `socket.conn.transport.name === 'websocket'`

## Deploy to Staging

- [ ] Merge feature branch to staging
- [ ] Deploy backend to staging environment
- [ ] Deploy frontend to staging environment
- [ ] Smoke test: Create game, join with 5 players, start game

## Staging Tests

Run automated test suite:

- [ ] Test 1: Single player baseline
  ```bash
  cd tests/phase3-scale
  npx playwright test diagnostics/01-join-latency-test.spec.ts --grep "1 player" --reporter=list
  ```
  Expected: <500ms ✅

- [ ] Test 2: 5 players parallel
  ```bash
  npx playwright test diagnostics/01-join-latency-test.spec.ts --grep "5 players join in parallel" --reporter=list
  ```
  Expected: <1000ms ✅

- [ ] Test 3: 10 players parallel
  ```bash
  npx playwright test diagnostics/01-join-latency-test.spec.ts --grep "10 players" --reporter=list
  ```
  Expected: <2000ms ✅

- [ ] Test 4: 20 players parallel (THE CRITICAL TEST)
  ```bash
  npx playwright test diagnostics/01-join-latency-test.spec.ts --grep "20 players" --reporter=list
  ```
  Expected: <5000ms ✅ (was timing out before)

- [ ] Test 5: Breaking point finder
  ```bash
  npx playwright test diagnostics/02-find-breaking-point.spec.ts --reporter=list
  ```
  Expected: Should successfully test 20, 25, 30, 35, 40, 45, 50 players ✅

## Validation Checks

- [ ] Verify in browser DevTools: Connection type is "websocket"
- [ ] Check backend logs: No "polling" transport in connection logs
- [ ] Game start latency for 20 players: <2 seconds ✅
- [ ] Game start latency for 50 players: <5 seconds ✅
- [ ] No timeout errors in test output ✅

## Full Load Test Suite (Optional but Recommended)

- [ ] Run all 9 load test scenarios:
  ```bash
  npx playwright test scenarios/ --reporter=html
  ```
  Expected: All tests pass ✅

## Monitoring Setup (Optional)

- [ ] Add metric: Track transport type (websocket vs polling)
  ```typescript
  io.on('connection', (socket) => {
    metrics.increment('socket.transport', {
      type: socket.conn.transport.name
    });
  });
  ```

- [ ] Add metric: Track game start broadcast latency
  ```typescript
  const startTime = Date.now();
  io.to(gameId).emit('game:started', data);
  metrics.histogram('game.start.latency', Date.now() - startTime);
  ```

- [ ] Set up CloudWatch alert: Alert if >10% connections use polling

## Production Deployment

- [ ] Merge to main/production branch
- [ ] Deploy backend to production
- [ ] Deploy frontend to production
- [ ] Monitor logs for first 15 minutes:
  - Check connection types (should see "websocket")
  - Watch for any errors or timeouts
  - Verify no increase in error rate

## Production Validation

- [ ] Create test game with 5 real players → Verify starts quickly
- [ ] Create test game with 10 real players → Verify starts quickly
- [ ] Create test game with 20 real players (if possible) → Verify starts quickly
- [ ] Check application metrics dashboard:
  - Socket connections using websocket: >95% ✅
  - Game start errors: <1% ✅
  - Game start latency P99: <3s ✅

## Rollback Plan (If Issues Occur)

- [ ] Document current production versions (backend + frontend)
- [ ] Have rollback command ready:
  ```bash
  # Rollback backend
  aws apprunner update-service --service-arn <arn> --source-configuration <previous>

  # Rollback frontend
  aws amplify start-deployment --app-id <id> --job-id <previous-job>
  ```
- [ ] If rollback needed: Remove 'websocket' from transports, deploy previous version

## Success Criteria (All Must Pass)

- [ ] 20 players can join and start a game successfully
- [ ] Game start completes in <2 seconds for 20 players
- [ ] Browser DevTools shows "websocket" connection (not "polling")
- [ ] No timeout errors in production logs
- [ ] All diagnostic tests pass on staging
- [ ] Production metrics show >95% websocket connections

## Documentation

- [ ] Update README with WebSocket requirement
- [ ] Document new capacity: 50+ concurrent players per game
- [ ] Update architecture docs with WebSocket transport
- [ ] Add troubleshooting guide for WebSocket connection issues

## Post-Implementation Review

- [ ] Measure actual improvement:
  - Game start latency before: ___ms
  - Game start latency after: ___ms
  - Max tested player count before: 18
  - Max tested player count after: ___

- [ ] Update capacity planning docs with new limits
- [ ] Share success metrics with team

---

## Quick Reference

**Issue:** Game start timeout with 20+ players
**Fix:** Enable WebSocket transport in Socket.IO
**Test:** `npx playwright test diagnostics/ --reporter=list`
**Success:** 20-player game starts in <2 seconds

**Full details:** See `DEV-ISSUE-REPORT.md`
**Quick summary:** See `DEV-ISSUE-SUMMARY.md`
