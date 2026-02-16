# Diagnostic Test Suite - Investigation & Fix Guide

## 📋 Quick Start

This diagnostic suite helps you **validate**, **investigate**, and **fix** the player join bottleneck systematically.

---

## 🎯 What This Does

1. **Confirms the issue is real** with incremental load tests (1, 5, 10, 20 players)
2. **Identifies the root cause** through systematic investigation
3. **Provides specific fixes** based on evidence
4. **Validates fixes work** by re-running tests

---

## 🚀 Step-by-Step Guide

### Step 1: Run Diagnostic Tests (10 minutes)

This will test the system at different scales to pinpoint where it breaks:

```bash
cd /Users/stageadmin/tambola-game/tambola-backend/tests/phase3-scale

# Run all diagnostic tests
npx playwright test diagnostics/01-join-latency-test.spec.ts --reporter=list
```

**What to expect:**
- Test 1: ✅ Single player (should pass)
- Test 2: ✅ 5 players sequential (should pass)
- Test 3: ⚠️ 5 players parallel (may fail)
- Test 4: ❌ 10 players parallel (likely fails)
- Test 5: ❌ 20 players parallel (very likely fails)

**This confirms:**
- ✅ If parallel tests fail → **Concurrency bottleneck confirmed**
- ✅ If sequential passes → **Not a general performance issue**

---

### Step 2: Investigate Backend (30 minutes)

Run the investigation script to gather evidence:

```bash
./diagnostics/investigate-backend.sh
```

**This script will:**
- ✅ Check backend health
- ✅ Test API endpoints
- ✅ Show how to access backend logs
- ✅ Provide database queries to run
- ✅ List CloudWatch metrics to check

**Then manually check:**

#### Option A: Quick (No AWS access)
```bash
# Look at backend source code for bottlenecks
cd ../../src
grep -r "game:join" . -A 20
grep -r "generateTicket" . -A 10
```

#### Option B: Full (With AWS access)
```bash
# View live backend logs while running test
aws logs tail /aws/apprunner/tambola-backend/d22a49b7907f45118cd1af314d9e0adc/application \
  --follow \
  --region ap-south-1 \
  --filter-pattern "game:join OR game:joined OR error"
```

---

### Step 3: Identify Root Cause

Based on test results and logs, identify the bottleneck:

| Symptom | Root Cause | Fix |
|---------|------------|-----|
| Logs show "Ticket generation: 300ms+" | CPU-bound ticket generation | Pre-generate tickets or use worker threads |
| Database shows 50/50 connections | Connection pool exhausted | Increase pool size |
| Slow query logs show player INSERT | Missing database indexes | Add indexes |
| Sequential works, parallel fails | Concurrency issue | Implement join queue |
| High CPU during joins | Event loop blocking | Offload to worker thread |

---

### Step 4: Apply Fixes

See detailed fix instructions in:
```
./diagnostics/fix-recommendations.md
```

**Quick fixes (5-30 minutes each):**

#### Fix A: Add Database Indexes
```sql
CREATE INDEX idx_players_game_id ON players(game_id);
CREATE INDEX idx_players_user_id_game_id ON players(user_id, game_id);
```

#### Fix B: Increase Connection Pool
```bash
# In .env or AWS App Runner
DATABASE_URL="...?connection_limit=100"
```

#### Fix C: Implement Join Queue
```bash
npm install p-queue
```
```typescript
import PQueue from 'p-queue';
const joinQueue = new PQueue({ concurrency: 10 });
```

---

### Step 5: Validate Fix Works (15 minutes)

After deploying fixes, re-run diagnostic tests:

```bash
npx playwright test diagnostics/01-join-latency-test.spec.ts --reporter=list
```

**Success criteria:**
- ✅ All tests pass (1, 5, 10, 20 players)
- ✅ No timeouts
- ✅ Average join latency < 500ms
- ✅ P99 join latency < 1000ms

---

### Step 6: Run Full Load Tests (30 minutes)

Once diagnostic tests pass, run the full test suite:

```bash
# Run all 5 critical load tests
npx playwright test scenarios/10-win-claim-race-100.spec.ts
npx playwright test scenarios/11-massive-scale-500.spec.ts
npx playwright test scenarios/12-reconnection-storm-500.spec.ts
npx playwright test scenarios/13-database-pool-stress.spec.ts
npx playwright test scenarios/14-redis-memory-management.spec.ts

# Or run all at once
npx playwright test scenarios/ --reporter=html
```

---

## 📊 Expected Results

### Before Fix:
```
Diagnostic Test 1 (1 player):      ✅ 500ms
Diagnostic Test 2 (5 sequential):  ✅ 2000ms total (400ms each)
Diagnostic Test 3 (5 parallel):    ⚠️ 2000ms (some slow)
Diagnostic Test 4 (10 parallel):   ❌ 8 success, 2 timeout
Diagnostic Test 5 (20 parallel):   ❌ 12 success, 8 timeout

Full Load Tests:                   ❌ All fail at join step
```

### After Fix:
```
Diagnostic Test 1 (1 player):      ✅ 200ms
Diagnostic Test 2 (5 sequential):  ✅ 1000ms total (200ms each)
Diagnostic Test 3 (5 parallel):    ✅ 800ms (all succeed)
Diagnostic Test 4 (10 parallel):   ✅ 10 success (< 2000ms)
Diagnostic Test 5 (20 parallel):   ✅ 20 success (< 5000ms)

Full Load Tests:                   ✅ All pass
```

---

## 🛠️ Files in This Directory

```
diagnostics/
├── README.md                        ← You are here
├── 01-join-latency-test.spec.ts     ← Diagnostic tests (run first)
├── investigate-backend.sh           ← Investigation script
└── fix-recommendations.md           ← Detailed fix guide
```

---

## 🎯 Success Metrics

Your system is ready for production when:

- ✅ **50 players can join simultaneously** in < 5 seconds
- ✅ **No join timeouts** (< 1% failure rate acceptable)
- ✅ **P99 join latency** < 1000ms
- ✅ **Database connections** stay under 80% of pool limit
- ✅ **All 5 full load tests** pass consistently

---

## 💡 Pro Tips

### Tip 1: Run Tests in Stages
Don't jump to 50 players. Validate each scale:
1. 1 player works → 5 players → 10 players → 20 players → 50 players

### Tip 2: Monitor While Testing
Run tests in one terminal, watch logs in another:
```bash
# Terminal 1: Run test
npx playwright test diagnostics/01-join-latency-test.spec.ts

# Terminal 2: Watch logs
aws logs tail /aws/apprunner/tambola-backend/<id>/application --follow
```

### Tip 3: Don't Test in Production
- Set up a staging environment
- Use `BACKEND_URL` environment variable to point to staging

### Tip 4: Document Your Findings
Keep notes as you investigate:
```
Issue: 10 concurrent joins timeout
Evidence: Logs show "Ticket generation: 450ms"
Root Cause: CPU-bound ticket generation blocks event loop
Fix Applied: Moved to worker thread
Result: All joins now < 200ms ✅
```

---

## ❓ FAQ

**Q: What if diagnostic tests pass but full load tests still fail?**
A: The bottleneck is in a different part of the flow (e.g., number calling, win claims). Run diagnostic tests for those flows.

**Q: Can I run tests against production?**
A: **NO.** Always use a staging environment for load tests. Load tests can cause production outages.

**Q: How do I know which fix to apply?**
A: The diagnostic tests + investigation will tell you. Don't guess - investigate first.

**Q: What if multiple fixes are needed?**
A: Apply them one at a time, validating after each fix. This helps you measure impact.

---

## 🚨 Emergency Quick Fix

If production is currently broken and you need a quick fix **right now**:

```typescript
// Emergency rate limiting (5-minute fix)
const joinQueue = [];
const CONCURRENT_JOINS = 5;
let processing = 0;

socket.on('game:join', async (data, callback) => {
  if (processing >= CONCURRENT_JOINS) {
    joinQueue.push({ socket, data, callback });
    return;
  }

  processing++;
  try {
    await handleJoin(socket, data, callback);
  } finally {
    processing--;
    if (joinQueue.length > 0) {
      const next = joinQueue.shift();
      socket.emit('game:join', next.data);
    }
  }
});
```

This is a **band-aid fix** - still apply proper fixes afterward.

---

## 📞 Need Help?

If you're stuck:
1. Review the fix-recommendations.md for detailed solutions
2. Check backend logs for specific errors
3. Run the investigation script to gather evidence
4. Start with the simplest fix (database indexes) first

---

**Ready to start?** Run:
```bash
npx playwright test diagnostics/01-join-latency-test.spec.ts --reporter=list
```
