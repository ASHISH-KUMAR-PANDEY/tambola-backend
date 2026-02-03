# Dev Environment - Quick Start Guide

## ✅ What's Already Set Up

### AWS Infrastructure (Created)
- ✅ **ECR Repository:** `tambola-backend-dev`
  - URI: `637436419278.dkr.ecr.ap-south-1.amazonaws.com/tambola-backend-dev`

- ✅ **S3 Bucket:** `tambola-promotional-images-dev`
  - CORS configured for dev frontend
  - Public read access enabled for banners
  - Bucket policy configured

- ✅ **GitHub Branch:** `dev` branch created and pushed

- ✅ **Deployment Workflow:** `.github/workflows/deploy-dev.yml`
  - Auto-deploys on push to `dev` branch
  - Uses DEV_* environment variables

### What Still Needs Setup

- 🔄 **Dev Database:** Create `tambola_db_dev` in existing RDS
- 🔄 **GitHub Secrets:** Add DEV_* secrets
- 🔄 **Amplify Dev Branch:** Create and configure
- 🔄 **First Deployment:** Trigger dev deployment

---

## 🚀 Complete Setup Steps

### Step 1: Create Dev Database

**Option A: Using Docker (Recommended if no psql installed)**
```bash
docker run -it --rm postgres:17 psql \
  -h tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com \
  -U tambolaadmin \
  -d postgres \
  -c "CREATE DATABASE tambola_db_dev;"
# Password: TambolaDB2024SecurePass
```

**Option B: Using psql directly**
```bash
PGPASSWORD="TambolaDB2024SecurePass" psql \
  -h tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com \
  -U tambolaadmin \
  -d postgres \
  -c "CREATE DATABASE tambola_db_dev;"
```

**Option C: Using pgAdmin or any PostgreSQL client**
- Host: `tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com`
- Port: `5432`
- User: `tambolaadmin`
- Password: `TambolaDB2024SecurePass`
- Run: `CREATE DATABASE tambola_db_dev;`

### Step 2: Add GitHub Secrets

Go to: https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/settings/secrets/actions

Add these secrets:

```bash
# 1. Dev Database URL
Secret Name: DEV_DATABASE_URL
Value: postgresql://tambolaadmin:TambolaDB2024SecurePass@tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com:5432/tambola_db_dev

# 2. Dev Redis URL (using same Redis instance with key isolation)
Secret Name: DEV_REDIS_URL
Value: redis://tambola-redis-mumbai.jnmrpn.0001.aps1.cache.amazonaws.com:6379

# 3. Dev JWT Secret (GENERATED FOR YOU)
Secret Name: DEV_JWT_SECRET
Value: MU7qXM0H8EpLHDyQhqx+gtucg45QLXmmWNqZOOpW0Bw=

# 4. Dev Frontend URL (will update after Amplify branch created)
Secret Name: DEV_FRONTEND_URL
Value: https://dev.d262mxsv2xemak.amplifyapp.com
```

**Quick Command to Add Secrets (if gh CLI installed):**
```bash
gh secret set DEV_DATABASE_URL --body "postgresql://tambolaadmin:TambolaDB2024SecurePass@tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com:5432/tambola_db_dev"

gh secret set DEV_REDIS_URL --body "redis://tambola-redis-mumbai.jnmrpn.0001.aps1.cache.amazonaws.com:6379"

gh secret set DEV_JWT_SECRET --body "MU7qXM0H8EpLHDyQhqx+gtucg45QLXmmWNqZOOpW0Bw="

gh secret set DEV_FRONTEND_URL --body "https://dev.d262mxsv2xemak.amplifyapp.com"
```

### Step 3: Create Amplify Dev Branch

**Option A: Via AWS Console (Recommended)**

1. Go to: https://console.aws.amazon.com/amplify/home?region=ap-south-1#/d262mxsv2xemak
2. Click "Connect branch"
3. Select `dev` branch from the dropdown
4. Click "Next"
5. Use same build settings as main
6. Add environment variables:
   - `VITE_API_URL`: `https://[will-get-after-backend-deploy]`
   - `VITE_WS_URL`: `https://[will-get-after-backend-deploy]`
7. Click "Save and deploy"

**Option B: Via AWS CLI**
```bash
aws amplify create-branch \
  --app-id d262mxsv2xemak \
  --branch-name dev \
  --region ap-south-1 \
  --enable-auto-build \
  --framework React \
  --stage DEVELOPMENT
```

### Step 4: Trigger Dev Deployment

**Option A: Via Git Push (Recommended)**
```bash
cd /Users/stageadmin/tambola-game/tambola-backend
git checkout dev
git push origin dev
```

**Option B: Via GitHub UI**
1. Go to: https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/actions
2. Click "Deploy Dev Backend to AWS App Runner"
3. Click "Run workflow"
4. Select branch: `dev`
5. Click "Run workflow"

### Step 5: Get Dev Backend URL

After deployment completes (~2-3 minutes):

```bash
aws apprunner list-services \
  --region ap-south-1 \
  --query "ServiceSummaryList[?ServiceName=='tambola-backend-dev'].[ServiceName,ServiceUrl,Status]" \
  --output table
```

### Step 6: Update Amplify Dev Branch with Backend URL

✅ **Dev Backend URL:** `https://jurpkxvw5m.ap-south-1.awsapprunner.com`

**Via AWS Console (Recommended):**
1. Go to: https://console.aws.amazon.com/amplify/home?region=ap-south-1#/d262mxsv2xemak
2. Select `dev` branch
3. Click "Environment variables"
4. Add/Update:
   - `VITE_API_URL`: `https://jurpkxvw5m.ap-south-1.awsapprunner.com`
   - `VITE_WS_URL`: `https://jurpkxvw5m.ap-south-1.awsapprunner.com`
5. Click "Save"
6. Redeploy the frontend branch

**Via AWS CLI:**
```bash
aws amplify update-branch \
  --app-id d262mxsv2xemak \
  --branch-name dev \
  --region ap-south-1 \
  --environment-variables \
    VITE_API_URL=https://jurpkxvw5m.ap-south-1.awsapprunner.com \
    VITE_WS_URL=https://jurpkxvw5m.ap-south-1.awsapprunner.com

# Trigger redeploy
aws amplify start-job \
  --app-id d262mxsv2xemak \
  --branch-name dev \
  --job-type RELEASE \
  --region ap-south-1
```

---

## 🎯 Development Workflow

### 1. Start New Feature

```bash
# Switch to dev branch
git checkout dev
git pull origin dev

# Create feature branch
git checkout -b feature/my-feature

# Make changes
# ... code ...

# Commit
git add .
git commit -m "feat: Add new feature"

# Push
git push origin feature/my-feature
```

### 2. Create PR to Dev

```bash
# Via gh CLI
gh pr create --base dev --title "Add new feature" --body "Description"

# Or via GitHub UI
# https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/compare/dev...feature/my-feature
```

### 3. Test on Dev Environment

After merging to `dev`:
- Automatic deployment to dev environment
- Test on dev URLs:
  - Frontend: `https://dev.d262mxsv2xemak.amplifyapp.com`
  - Backend: `https://[dev-backend-url]`

### 4. Promote to Production

```bash
# Create PR from dev to main
gh pr create --base main --head dev --title "Production release" --body "Tested on dev"

# Or via GitHub UI
# https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/compare/main...dev
```

---

## 🔍 Verification Commands

### Check Dev Infrastructure

```bash
# Check ECR repo
aws ecr describe-repositories \
  --repository-names tambola-backend-dev \
  --region ap-south-1

# Check S3 bucket
aws s3 ls s3://tambola-promotional-images-dev/

# Check App Runner service
aws apprunner list-services \
  --region ap-south-1 \
  --query "ServiceSummaryList[?ServiceName=='tambola-backend-dev']"

# Check dev database (requires psql)
PGPASSWORD="TambolaDB2024SecurePass" psql \
  -h tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com \
  -U tambolaadmin \
  -d tambola_db_dev \
  -c "\l"
```

### Check Deployment Status

```bash
# Check GitHub Actions runs
gh run list --branch dev --limit 5

# Watch latest run
gh run watch

# Check logs
gh run view --log
```

### Health Check

```bash
# After deployment, test dev backend
curl https://[dev-backend-url]/health

# Expected response:
# {"status":"ok","timestamp":"2026-02-03T..."}
```

---

## 💰 Cost Impact

### Cost-Optimized Setup (Recommended)
- **Additional Monthly Cost:** ~$26
  - App Runner Dev: $25
  - S3 Dev: $1
  - Database: $0 (using same RDS)
  - Redis: $0 (using same Redis)

### Total (Prod + Dev)
- **Production:** $57/month
- **Dev:** $26/month
- **Total:** $83/month

---

## 📚 Key Differences: Dev vs Production

| Aspect | Production (main) | Development (dev) |
|--------|-------------------|-------------------|
| Branch | `main` | `dev` |
| ECR Repo | `tambola-backend` | `tambola-backend-dev` |
| App Runner | `tambola-backend` | `tambola-backend-dev` |
| Database | `tambola_db` | `tambola_db_dev` |
| Redis | Same instance | Same instance (isolated keys) |
| S3 Bucket | `tambola-promotional-images-mumbai` | `tambola-promotional-images-dev` |
| Frontend URL | `main.d262mxsv2xemak.amplifyapp.com` | `dev.d262mxsv2xemak.amplifyapp.com` |
| NODE_ENV | `production` | `development` |
| LOG_LEVEL | `info` | `debug` |

---

## ✅ Setup Checklist

### AWS Infrastructure
- [x] ECR repository created
- [x] S3 bucket created
- [x] S3 CORS configured
- [x] S3 bucket policy configured
- [ ] Dev database created (Step 1 above)

### GitHub Configuration
- [x] Dev branch created
- [x] Dev workflow added
- [ ] GitHub secrets added (Step 2 above)

### Amplify
- [ ] Dev branch connected (Step 3 above)
- [ ] Environment variables set (Step 6 above)

### Deployment
- [ ] First dev deployment completed (Step 4 above)
- [ ] Dev backend URL obtained (Step 5 above)
- [ ] Frontend updated with backend URL (Step 6 above)

### Testing
- [ ] Dev backend health check passes
- [ ] Dev frontend loads correctly
- [ ] Can create account on dev
- [ ] Can create game on dev
- [ ] WebSocket connection works on dev

---

## 🆘 Troubleshooting

### Issue: Dev deployment fails with "Service not found"

**Solution:** The App Runner service will be created automatically on first deployment. Just wait for the GitHub Actions workflow to complete.

### Issue: Can't connect to dev database

**Solution:** Make sure the database `tambola_db_dev` exists (run Step 1 again).

### Issue: S3 upload fails on dev

**Solution:** Check that S3 bucket `tambola-promotional-images-dev` exists and has correct permissions.

### Issue: CORS errors on dev frontend

**Solution:** Make sure CORS_ORIGIN environment variable includes the dev frontend URL.

---

## 📞 Support

For issues:
1. Check GitHub Actions logs: https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/actions
2. Check App Runner logs via AWS Console
3. Check deployment documentation: `DEV_ENVIRONMENT_SETUP.md`

---

**Quick Links:**
- GitHub Repo: https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend
- GitHub Actions: https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/actions
- GitHub Secrets: https://github.com/ASHISH-KUMAR-PANDEY/tambola-backend/settings/secrets/actions
- AWS Console: https://ap-south-1.console.aws.amazon.com/

---

**Status:** 🟡 Ready for Setup
**Next Step:** Follow Step 1 above to create dev database

**Document Version:** 1.0
**Last Updated:** February 3, 2026
