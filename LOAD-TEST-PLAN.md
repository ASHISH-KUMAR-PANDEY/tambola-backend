# Load Test Plan - Agreed Approach

## 📋 Test Configuration

### Phases to Run Today
- ✅ **Phase 1:** Baseline (10 players)
- ✅ **Phase 2:** Target Load (50 players)
- ✅ **Phase 3:** Chaos Testing (50 players + disruptions)

### Latency Benchmarks (Industry Standard)
Based on real-time multiplayer game standards:

| Metric | Excellent | Good | Acceptable | Poor |
|--------|-----------|------|------------|------|
| **Number Broadcast** | < 300ms | 300-500ms | 500-800ms | > 1000ms |
| **Player Actions** | < 200ms | 200-500ms | 500-1000ms | > 1000ms |
| **Reconnection** | < 3s | 3-5s | 5-10s | > 10s |
| **State Sync** | < 500ms | 500ms-1s | 1-2s | > 2s |

**Our Target:** < 500ms broadcast latency for 50 players

### Test Script Features
- ✅ Silent execution (minimal console output)
- ✅ Auto-cleanup (deletes test games)
- ✅ Final report with pass/fail
- ✅ Exports detailed metrics to JSON
- ✅ Comprehensive logging captures everything

---

## 📊 Phase Details

### Phase 1: Baseline (10 players)
**Duration:** ~5-7 minutes

**Actions:**
1. Create 1 organizer + 10 players
2. All join game
3. Start game
4. Call all 90 numbers (3s delay per number)
5. Measure broadcast latency, delivery rate

**Pass Criteria:**
- ✅ 100% connection rate
- ✅ > 98% delivery rate (all players receive all numbers)
- ✅ < 500ms average broadcast latency

### Phase 2: Target Load (50 players)
**Duration:** ~5-7 minutes

**Actions:**
1. Create 1 organizer + 50 players
2. All 50 join simultaneously (stress test)
3. Start game
4. Call all 90 numbers (3s delay per number)
5. Measure broadcast latency, delivery rate

**Pass Criteria:**
- ✅ 100% connection rate
- ✅ > 98% delivery rate
- ✅ < 500ms average broadcast latency

### Phase 3: Chaos Testing (50 players + disruptions)
**Duration:** ~5-7 minutes

**Actions:**
1. Create 1 organizer + 50 players
2. All 50 join game
3. Start game
4. Call numbers with disruptions:
   - After 20 numbers: Disconnect 10 random players
   - After 25 numbers: Reconnect those 10 players
   - After 30 numbers: 10 NEW players join mid-game
5. Continue calling remaining numbers
6. Measure resilience, reconnection time, state sync

**Pass Criteria:**
- ✅ > 95% connection rate (accounting for intentional disconnects)
- ✅ > 95% delivery rate
- ✅ < 500ms average broadcast latency
- ✅ All reconnections successful within 5 seconds

---

## 📈 Metrics Tracked

### Connection Metrics
- Total players
- Connected players
- Connection rate (%)
- Disconnection events
- Reconnection success rate

### Performance Metrics
- Numbers called total
- Average numbers received per player
- Min/max numbers received
- Delivery rate (%)
- Broadcast latency: avg, min, max
- Number of samples measured

### Quality Metrics
- Errors encountered
- Pass/fail status per phase

---

## 🎯 Success Criteria

**Overall Test Passes If:**
1. ✅ All 3 phases pass
2. ✅ Broadcast latency < 500ms average
3. ✅ Delivery rate > 98% (Phase 1 & 2), > 95% (Phase 3)
4. ✅ Zero critical errors
5. ✅ Reconnections work within 5 seconds

**If Any Phase Fails:**
- Review CloudWatch logs for backend issues
- Check metrics JSON for detailed timings
- Identify bottleneck (database, Redis, broadcasting, network)
- Fix and re-run

---

## 📝 Output

### Console Output (Silent Mode)
```
🔵 PHASE 1: Baseline (10 players)
Creating organizer and 10 players...
Creating game...
Connecting organizer...
Connecting 10 players...
Calling 90 numbers (3s delay per number)...
Cleaning up...

🟢 PHASE 2: Target Load (50 players)
...

🟡 PHASE 3: Chaos Testing (50 players + disruptions)
...

═══════════════════════════════════════
         LOAD TEST RESULTS
═══════════════════════════════════════

Phase 1: ✅ PASSED
  Players: 10/10 (100%)
  Broadcast Latency: avg 234ms, max 456ms
  Delivery Rate: 99.7%

Phase 2: ✅ PASSED
  Players: 50/50 (100%)
  Broadcast Latency: avg 387ms, max 623ms
  Delivery Rate: 98.9%

Phase 3: ✅ PASSED
  Players: 60/60 (100%)
  Broadcast Latency: avg 412ms, max 789ms
  Delivery Rate: 97.1%

🎉 ALL PHASES PASSED!
═══════════════════════════════════════
```

### Files Generated
- `load-test-results-[timestamp].json` - Detailed metrics
- CloudWatch logs - All backend timings, errors, performance

---

## 🚀 Ready to Execute

**Estimated Total Time:** 15-20 minutes

**Command to run:**
```bash
node load-test.mjs
```

**After completion:**
1. Review final report
2. Check CloudWatch for backend logs
3. Analyze metrics JSON if any phase failed
4. System is ready for production if all phases pass

---

## ✅ Agreement Confirmed

- [x] Run Phases 1, 2, 3 today
- [x] Target < 500ms broadcast latency
- [x] Auto-delete test games
- [x] Silent run with final report
- [x] Logs capture all details
