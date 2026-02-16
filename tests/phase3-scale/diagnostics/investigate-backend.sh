#!/bin/bash

###############################################################################
# Backend Investigation Script
# Purpose: Gather evidence to validate the join bottleneck issue
###############################################################################

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║        TAMBOLA BACKEND INVESTIGATION TOOLKIT               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

###############################################################################
# 1. Check Backend Health
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  BACKEND HEALTH CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

BACKEND_URL="https://nhuh2kfbwk.ap-south-1.awsapprunner.com"

echo "Testing: $BACKEND_URL/health"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$BACKEND_URL/health" 2>&1)
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Backend is responding${NC}"
    echo "Response: $HEALTH_BODY"
else
    echo -e "${RED}❌ Backend health check failed (HTTP $HTTP_CODE)${NC}"
fi
echo ""

###############################################################################
# 2. Test API Endpoints
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  API ENDPOINT AVAILABILITY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if /api/v1 prefix is needed
echo "Testing: $BACKEND_URL/api/v1/games (OPTIONS)"
curl -s -X OPTIONS "$BACKEND_URL/api/v1/games" -w "HTTP Status: %{http_code}\n" -o /dev/null
echo ""

###############################################################################
# 3. Fetch Recent Backend Logs
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  RECENT BACKEND LOGS (Last 50 lines)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v aws &> /dev/null; then
    echo -e "${YELLOW}Fetching logs from AWS App Runner...${NC}"
    echo ""

    # Try to get service ARN
    SERVICE_ARN="arn:aws:apprunner:ap-south-1:637436419278:service/tambola-backend/d22a49b7907f45118cd1af314d9e0adc"

    echo "Command to view logs:"
    echo "  aws logs tail /aws/apprunner/tambola-backend/d22a49b7907f45118cd1af314d9e0adc/application --follow --region ap-south-1"
    echo ""
    echo "To filter for join events:"
    echo "  aws logs tail /aws/apprunner/tambola-backend/d22a49b7907f45118cd1af314d9e0adc/application --region ap-south-1 --filter-pattern 'game:join' --since 1h"
    echo ""
    echo -e "${YELLOW}Note: You may need AWS credentials configured${NC}"
    echo ""
else
    echo -e "${YELLOW}⚠️  AWS CLI not installed - cannot fetch logs automatically${NC}"
    echo ""
    echo "To view logs manually:"
    echo "1. Go to: AWS Console → App Runner → tambola-backend"
    echo "2. Click on 'Logs' tab"
    echo "3. Look for errors around 'game:join' events"
    echo ""
fi

###############################################################################
# 4. Database Connection Check
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  DATABASE CONNECTION CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Database: PostgreSQL on RDS (tambola-postgres-mumbai)"
echo "Region: ap-south-1"
echo ""

if command -v psql &> /dev/null; then
    echo -e "${YELLOW}To check database directly:${NC}"
    echo "  psql -h tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com -U <username> -d tambola_db"
    echo ""
else
    echo "PostgreSQL client not installed locally"
    echo ""
fi

echo "Recommended database checks:"
echo "  1. Check active connections:"
echo "     SELECT count(*) FROM pg_stat_activity;"
echo ""
echo "  2. Check connection pool exhaustion:"
echo "     SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"
echo ""
echo "  3. Check for slow queries:"
echo "     SELECT query, state, wait_event_type, wait_event "
echo "     FROM pg_stat_activity "
echo "     WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%';"
echo ""

###############################################################################
# 5. Redis Connection Check
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  REDIS CONNECTION CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "Redis: ElastiCache (tambola-redis-mumbai)"
echo "Region: ap-south-1"
echo ""

if command -v redis-cli &> /dev/null; then
    echo -e "${YELLOW}To check Redis directly:${NC}"
    echo "  redis-cli -h tambola-redis-mumbai.jnmrpn.0001.aps1.cache.amazonaws.com"
    echo ""
else
    echo "Redis client not installed locally"
    echo ""
fi

echo "Recommended Redis checks:"
echo "  1. Check memory usage:"
echo "     INFO memory"
echo ""
echo "  2. Check connected clients:"
echo "     CLIENT LIST"
echo ""
echo "  3. Check slow operations:"
echo "     SLOWLOG GET 10"
echo ""

###############################################################################
# 6. Performance Metrics
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6️⃣  CLOUDWATCH METRICS (if available)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v aws &> /dev/null; then
    echo "To view CloudWatch metrics:"
    echo ""
    echo "App Runner CPU/Memory:"
    echo "  aws cloudwatch get-metric-statistics \\"
    echo "    --namespace AWS/AppRunner \\"
    echo "    --metric-name CPUUtilization \\"
    echo "    --dimensions Name=ServiceName,Value=tambola-backend \\"
    echo "    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \\"
    echo "    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \\"
    echo "    --period 300 \\"
    echo "    --statistics Average \\"
    echo "    --region ap-south-1"
    echo ""

    echo "RDS Database Connections:"
    echo "  aws cloudwatch get-metric-statistics \\"
    echo "    --namespace AWS/RDS \\"
    echo "    --metric-name DatabaseConnections \\"
    echo "    --dimensions Name=DBInstanceIdentifier,Value=tambola-postgres-mumbai \\"
    echo "    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \\"
    echo "    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \\"
    echo "    --period 300 \\"
    echo "    --statistics Average,Maximum \\"
    echo "    --region ap-south-1"
    echo ""
else
    echo "AWS CLI not available"
    echo "View metrics manually at: AWS Console → CloudWatch → Metrics"
    echo ""
fi

###############################################################################
# 7. Investigation Summary
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "7️⃣  INVESTIGATION CHECKLIST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "To confirm the join bottleneck, check:"
echo ""
echo "  [ ] Backend logs show 'game:join' events"
echo "  [ ] Backend logs show 'game:joined' responses (or lack thereof)"
echo "  [ ] Database connection count during join spike"
echo "  [ ] Slow query logs in PostgreSQL"
echo "  [ ] Redis SLOWLOG during joins"
echo "  [ ] CPU utilization spike during joins"
echo "  [ ] Memory usage during joins"
echo ""

echo "Expected findings if bottleneck is real:"
echo ""
echo "  ❌ Multiple 'game:join' events without corresponding 'game:joined'"
echo "  ❌ Database connection pool at/near limit (e.g., 50/50 connections)"
echo "  ❌ Slow queries related to ticket generation or player insertion"
echo "  ❌ CPU spike during concurrent joins (ticket generation is CPU-heavy)"
echo "  ❌ Event loop lag in backend logs"
echo ""

###############################################################################
# 8. Next Steps
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "8️⃣  NEXT STEPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "1. Run the diagnostic test suite:"
echo "   cd tests/phase3-scale"
echo "   npx playwright test diagnostics/01-join-latency-test.spec.ts --reporter=list"
echo ""

echo "2. Monitor backend logs while running tests:"
echo "   ./diagnostics/investigate-backend.sh"
echo ""

echo "3. If bottleneck is confirmed, proceed to fixing:"
echo "   ./diagnostics/fix-recommendations.md"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
