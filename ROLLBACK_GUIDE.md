# Rollback Guide

## Current Stable Release

**Tag:** `v1.0.0-stable`
**Commit:** `5805f400b8b886db43cedc6ecc48350a9e687b54`
**Date:** 2026-02-03 17:07:00
**Status:** ✅ Production Ready

### What's Included
- Backend API deployed on AWS App Runner
- PostgreSQL database with Prisma ORM
- Redis for session management
- S3 for promotional banner uploads (ACL issue fixed)
- WebSocket support for real-time game functionality
- JWT authentication
- CORS configured for Amplify frontend

---

## How to Rollback

### Option 1: Rollback to Stable Tag (Recommended)

```bash
# Switch to main branch
git checkout main

# Rollback to stable release
git reset --hard v1.0.0-stable

# Force push to remote (this will trigger deployment)
git push origin main --force
```

### Option 2: Rollback by Commit Hash

```bash
# Rollback to specific commit
git reset --hard 5805f400b8b886db43cedc6ecc48350a9e687b54

# Force push
git push origin main --force
```

### Option 3: Create Revert Commit (Safer)

```bash
# Create a revert commit instead of force push
git revert HEAD~1  # Revert last commit
# OR
git revert <bad-commit-hash>

# Push normally (no force needed)
git push origin main
```

---

## Verify Deployment After Rollback

```bash
# Check GitHub Actions deployment
gh run list --branch main --limit 1

# Watch deployment
gh run watch

# Verify backend health
curl https://xfejzczpwp.ap-south-1.awsapprunner.com/health

# Expected response:
# {"status":"ok","timestamp":"..."}
```

---

## Production URLs

### Backend
- **Production API:** `https://xfejzczpwp.ap-south-1.awsapprunner.com`
- **Health Check:** `https://xfejzczpwp.ap-south-1.awsapprunner.com/health`

### Frontend
- **Production URL:** `https://main.d262mxsv2xemak.amplifyapp.com`

---

## Emergency Rollback via AWS Console

If GitHub Actions is not working:

1. **App Runner Rollback:**
   - Go to: https://console.aws.amazon.com/apprunner/home?region=ap-south-1
   - Select `tambola-backend` service
   - Click "Deployments" tab
   - Select previous successful deployment
   - Click "Deploy this version"

2. **Amplify Rollback:**
   - Go to: https://console.aws.amazon.com/amplify/home?region=ap-south-1#/d262mxsv2xemak
   - Select `main` branch
   - View build history
   - Click "Redeploy this version" on last working build

---

## Tags Available

```bash
# List all tags
git tag -l

# Show tag details
git show v1.0.0-stable

# Check out specific tag
git checkout v1.0.0-stable
```

---

## Database Rollback

⚠️ **Database migrations cannot be automatically rolled back!**

If you need to rollback database changes:

1. Check migration history:
```bash
npx prisma migrate status
```

2. Manual rollback (if needed):
```bash
# Connect to database
psql postgresql://tambolaadmin:TambolaDB2024SecurePass@tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com:5432/tambola_db

# Manually revert schema changes
# Review prisma/migrations/ folder for changes
```

3. **Backup before risky changes:**
```bash
# Create database backup
aws rds create-db-snapshot \
  --db-instance-identifier tambola-postgres-mumbai \
  --db-snapshot-identifier tambola-backup-$(date +%Y%m%d-%H%M%S)
```

---

## Contact / Support

- **GitHub Repository:** https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend
- **GitHub Actions:** https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/actions
- **AWS Console:** https://ap-south-1.console.aws.amazon.com/

---

**Last Updated:** February 3, 2026
**Stable Release:** v1.0.0-stable
**Next Release:** TBD
