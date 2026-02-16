# Load Test Results - Phase 3 Scale Testing

**Test Date:** 2026-02-13
**Backend URL:** https://nhuh2kfbwk.ap-south-1.awsapprunner.com
**Test Environment:** 50 player accounts, 5 organizer accounts, all granted VIP access

---

## Executive Summary

✅ **VIP Access System:** Working perfectly
✅ **Join Performance (1-20 players):** Excellent (<2s for 20 players)
❌ **Scale Test (50 players):** Failed - xhr poll errors during game start

### Critical Finding

**Scalability Limit Discovered:** Backend can handle 20 concurrent players smoothly but fails at 50 players with connection errors. This indicates a bottleneck in:
- Socket.IO connection handling
- Game start broadcast to 50+ connections
- Or App Runner connection limits

---

## Diagnostic Test Results ✅

All diagnostic tests **PASSED** with excellent performance:

### Test 1: Single Player Baseline
- **Latency:** 272ms
- **Expected:** < 500ms
- **Status:** ✅ PASS

### Test 2: 5 Players Sequential Join
- **Average Latency:** 257ms
- **Maximum Latency:** 380ms
- **Expected:** < 500ms average
- **Status:** ✅ PASS

### Test 3: 5 Players Parallel Join
- **Total Time:** 402ms
- **Success Rate:** 5/5 (100%)
- **Average Latency:** 343ms
- **Expected:** < 2000ms total
- **Status:** ✅ PASS

### Test 4: 10 Players Parallel Join
- **Total Time:** 1009ms
- **Success Rate:** 10/10 (100%)
- **Latency Range:** 204ms - 1008ms
- **Average Latency:** 672ms
- **Expected:** < 5000ms total, ≥80% success
- **Status:** ✅ PASS

### Test 5: 20 Players Parallel Join (Stress)
- **Total Time:** 1644ms
- **Success Rate:** 20/20 (100%)
- **Latency Range:** 247ms - 1642ms
- **Average Latency:** 1238ms
- **Expected:** < 10000ms total, ≥75% success
- **Status:** ✅ ACCEPTABLE (minor degradation but 100% success)

**Diagnostic Conclusion:** Backend performs excellently for 1-20 concurrent players with consistent sub-2-second join times and 100% success rates.

---

## Load Test Results (50 Players) ❌

All 9 load test scenarios **FAILED** with similar error pattern.

### Common Failure Pattern

```
Error: xhr poll error
  at XHR.onError
  at Request.<anonymous>
  at Request.Emitter.emit
  at Request._onError
  at Timeout._onTimeout
```

### Test 1: Baseline 50-Player Game Flow
- **Status:** ❌ FAILED (58.7s timeout)
- **Progress:**
  - ✅ 50 players connected
  - ✅ 50 players joined game
  - ✅ Ticket validation passed
  - ✅ Auto-mark enabled for 25 players
  - ❌ **Failed at: Game Start**
- **Root Cause:** Connection error when broadcasting game start to 50 players

### Tests 2-9: Various 50-Player Scenarios
- **Status:** ❌ ALL FAILED
- **Common Pattern:** Failed during initial setup or game start
- **Error:** `xhr poll error` - Socket.IO polling transport failure

---

## Root Cause Analysis

### Probable Causes (Priority Order)

#### 1. AWS App Runner Connection Limits ⚠️ HIGH PROBABILITY
- App Runner may have per-instance connection limits
- Socket.IO uses long-polling (not WebSocket) due to App Runner constraints
- 50 simultaneous long-polling connections may exceed limits
- **Evidence:** Tests pass up to 20 players, fail at 50

#### 2. Socket.IO Broadcast Performance 🔍 MEDIUM PROBABILITY
- Broadcasting game start to 50 connections simultaneously
- Each player receives: ticket assignment, game state, number announcements
- May be hitting broadcast throughput limits
- **Evidence:** Failure occurs specifically at "game start" phase

#### 3. Backend Resource Limits 📊 MEDIUM PROBABILITY
- CPU/Memory constraints on App Runner instance
- May need vertical scaling (larger instance type)
- **Evidence:** Consistent failures across all 50-player tests

#### 4. Database Connection Pool 💾 LOW PROBABILITY
- Connection pool may be too small for 50 concurrent operations
- Less likely since join phase succeeds (which hits DB)
- **Evidence:** Join succeeds, game start fails (less DB intensive)

#### 5. Redis Connection Limits 🔴 LOW PROBABILITY
- Redis operations during game start
- Less likely since VIP checks work fine for 50 players
- **Evidence:** All players successfully join (Redis VIP check works)

---

## Performance Metrics

### Successful Range (1-20 players)
| Players | Join Time | Success Rate | Status |
|---------|-----------|--------------|--------|
| 1 | 272ms | 100% | ✅ Excellent |
| 5 (seq) | 1285ms | 100% | ✅ Excellent |
| 5 (par) | 402ms | 100% | ✅ Excellent |
| 10 (par) | 1009ms | 100% | ✅ Excellent |
| 20 (par) | 1644ms | 100% | ✅ Good |

### Failure Range (50 players)
| Players | Join Time | Game Start | Success Rate | Status |
|---------|-----------|------------|--------------|--------|
| 50 | ~varies | ❌ FAIL | 0% | ❌ Connection Error |

**Scalability Limit Identified:** Between 20-50 concurrent players

---

## Recommendations

### Immediate Actions (Required for Production)

#### 1. Investigate App Runner Configuration 🚨 CRITICAL
```bash
# Check current App Runner instance configuration
aws apprunner describe-service \
  --service-arn <service-arn> \
  --region ap-south-1 \
  --query 'Service.InstanceConfiguration'

# Key settings to check:
# - Cpu: Current vs available options
# - Memory: Current vs available options
# - MaxConcurrency: Connections per instance
```

**Action:** Increase App Runner instance size and MaxConcurrency

#### 2. Enable WebSocket Support 🔌 HIGH PRIORITY
App Runner now supports WebSocket (as of recent updates). Investigate enabling WebSocket transport instead of long-polling.

**Why:** WebSocket is more efficient than long-polling for 50+ concurrent connections.

**How:**
- Check if App Runner service supports WebSocket
- Update Socket.IO client/server config to prefer WebSocket
- Remove polling fallback for production

#### 3. Implement Connection Rate Limiting ⏱️ HIGH PRIORITY
```typescript
// In Socket.IO server config
io.engine.on('connection_error', (err) => {
  console.error('Connection error:', err);
  metrics.recordConnectionError(err);
});

// Add rate limiting for game start broadcasts
async function startGame(gameId: string) {
  const players = await getGamePlayers(gameId);

  // Batch broadcasts instead of all at once
  const BATCH_SIZE = 10;
  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    await broadcastToBatch(batch, 'game:started');
    await sleep(50); // 50ms delay between batches
  }
}
```

#### 4. Add Comprehensive Monitoring 📊 HIGH PRIORITY
```typescript
// Track these metrics:
- Active socket connections count
- Broadcast latency (P50, P90, P99)
- Connection errors by type
- Game start duration by player count
- App Runner CPU/Memory utilization

// CloudWatch alarms:
- Alert if active connections > 40
- Alert if broadcast latency P99 > 3s
- Alert if connection errors > 5%
```

#### 5. Run Incremental Load Tests 🧪 MEDIUM PRIORITY
Test at 25, 30, 35, 40, 45 players to find exact breaking point:

```bash
# Run tests with specific player counts
npx playwright test --grep "25 players"
npx playwright test --grep "30 players"
npx playwright test --grep "35 players"
npx playwright test --grep "40 players"
```

### Medium-Term Improvements

#### 6. Optimize Ticket Generation 🎟️
Currently generates tickets synchronously. Consider:
- Pre-generate ticket pool
- Use worker thread for generation
- Cache ticket templates

#### 7. Implement Connection Pooling
- Database: Increase pool size for high concurrency
- Redis: Use connection pooling with ioredis cluster

#### 8. Load Balancing Strategy
- App Runner auto-scaling (multiple instances)
- Sticky sessions for Socket.IO
- Redis pub/sub for cross-instance communication

### Long-Term Optimizations

#### 9. Horizontal Scaling Architecture
- Multiple App Runner instances
- Redis Cluster for pub/sub
- Shared session store (Redis or DynamoDB)
- Load balancer with sticky sessions

#### 10. Separate Socket.IO Service
Consider separating Socket.IO into dedicated service:
- REST API → App Runner (stateless)
- Socket.IO → ECS Fargate (with WebSocket ALB)
- Benefits: Better scaling, WebSocket support, independent optimization

---

## Test Coverage Summary

### ✅ Validated (Working)
- VIP access control system
- Player join flow (1-20 players)
- Socket connection handling (1-20 players)
- Ticket generation and validation
- Join latency and throughput

### ❌ Not Validated (Failed)
- 50-player concurrent gameplay
- Win claim race conditions (50 players)
- Massive scale full game flow
- Reconnection storm handling
- Database pool stress under load
- Redis memory management with player churn

### ⏸️ Blocked Tests
All 50-player scenarios blocked by connection limit issue. Cannot validate:
- Distributed lock correctness at scale
- Broadcast latency P50/P90/P99 at 50 players
- Memory leak detection
- Connection pool stability
- State sync accuracy at scale

---

## Next Steps

### Before Production Launch

1. **Resolve 50-player connection issue** (BLOCKER)
   - Investigate App Runner limits
   - Enable WebSocket if available
   - Implement batched broadcasts

2. **Re-run load tests** after fixes
   - Validate 50-player scenarios
   - Test up to 100 players if possible
   - Verify all 5 critical scenarios pass

3. **Performance baseline**
   - Document P50/P90/P99 latencies
   - Set up CloudWatch dashboards
   - Configure alerts for degradation

4. **Capacity planning**
   - Define max players per game (current safe limit: 20)
   - Calculate App Runner instance requirements
   - Plan scaling strategy

### Questions to Answer

1. What is the App Runner MaxConcurrency setting?
2. Is WebSocket enabled on the App Runner service?
3. What are the current instance specs (CPU, Memory)?
4. Are there any rate limits or connection limits in place?
5. What does CloudWatch show during the test failures?

---

## Appendix: Test Execution Logs

### Diagnostic Tests - Detailed Output
```
✅ Test 1: 1 player join - 272ms (PASS)
✅ Test 2: 5 sequential - avg 257ms (PASS)
✅ Test 3: 5 parallel - 402ms total (PASS)
✅ Test 4: 10 parallel - 1009ms total (PASS)
✅ Test 5: 20 parallel - 1644ms total (PASS)
```

### Load Tests - Failure Summary
```
❌ Test 01: Baseline 50 players - xhr poll error at game start
❌ Test 03: Concurrent refresh - xhr poll error during setup
❌ Test 05: Mass leave/rejoin - xhr poll error at game start
❌ Test 09: Early 5 race - xhr poll error at game start
❌ Test 10: 50-player race - xhr poll error during setup
❌ Test 11: Massive scale - xhr poll error during setup
❌ Test 12: Reconnection storm - xhr poll error during setup
❌ Test 13: DB pool stress - xhr poll error during setup
❌ Test 14: Redis memory - xhr poll error during setup
```

---

## Conclusion

The tambola backend demonstrates **excellent performance for 1-20 concurrent players** with sub-2-second join times and 100% success rates. However, a **critical scalability bottleneck exists between 20-50 players**, manifesting as Socket.IO connection errors.

**Current Safe Capacity:** 20 concurrent players per game
**Target Capacity:** 50+ concurrent players per game
**Gap to Close:** Connection handling at 50+ scale

The VIP access control system works perfectly, and the join flow is solid. The issue is specifically with Socket.IO connection/broadcast handling at scale, likely due to App Runner configuration limits or lack of WebSocket support.

**Priority 1:** Investigate and fix App Runner connection limits
**Priority 2:** Enable WebSocket transport
**Priority 3:** Implement batched broadcasts
**Priority 4:** Add comprehensive monitoring

Once these issues are resolved, re-run the full test suite to validate production readiness.
