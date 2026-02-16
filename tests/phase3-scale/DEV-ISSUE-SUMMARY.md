# 🚨 URGENT: Game Start Timeout with 20+ Players

## Issue
Games cannot start when 20+ players are connected. Game start broadcast times out after 10 seconds.

## Impact
- **Current limit:** 15-18 players per game (unreliable at 20+)
- **Target capacity:** 50+ players per game
- **Status:** Production blocker for scaling

## Root Cause
Socket.IO is using HTTP long-polling instead of WebSocket. Broadcasting `game:started` event to 20+ polling connections takes >10 seconds.

## Solution (2-4 hours work)

### 1. Backend: Enable WebSocket Transport

**File:** `src/app.ts` or wherever Socket.IO server is initialized

```typescript
const io = new Server(httpServer, {
  cors: { /* existing config */ },
  transports: ['websocket', 'polling'], // Add 'websocket'
  allowUpgrades: true,
});
```

### 2. Frontend: Enable WebSocket Transport

**File:** Where Socket.IO client is initialized

```typescript
const socket = io(backendUrl, {
  auth: { userId },
  transports: ['websocket', 'polling'], // Add 'websocket'
  upgrade: true,
});
```

### 3. Verify AWS App Runner Supports WebSocket
App Runner supports WebSocket by default in recent versions. No config change needed unless explicitly disabled.

## Expected Result
- **Before:** >10 seconds to start game with 20 players → Timeout ❌
- **After:** <500ms to start game with 20 players → Success ✅
- **Capacity:** 15-18 players → 50+ players ✅

## Testing
```bash
cd tests/phase3-scale
npx playwright test diagnostics/01-join-latency-test.spec.ts --reporter=list
# Should pass all 5 tests including 20-player test
```

## Temporary Workaround (30 min)
Increase timeout from 10s to 30s on client side. Allows 20-25 players but poor UX.

## Full Details
See `DEV-ISSUE-REPORT.md` for complete technical analysis, code locations, and testing procedures.

---

**Priority:** P0 - Critical
**Effort:** 2-4 hours
**Solution:** Configuration change (add WebSocket to transports)
