# Tambola Game - Configuration Reference

**Last Updated**: 2026-02-12

This document contains ALL configuration locations to prevent future disruptions.

---

## Frontend Configuration (tambola-frontend)

### AWS Amplify Environment Variables
**Location**: AWS Amplify Console → App Settings → Environment Variables

**Current Production Values**:
```bash
VITE_API_URL="https://nhuh2kfbwk.ap-south-1.awsapprunner.com"
VITE_WS_URL="https://nhuh2kfbwk.ap-south-1.awsapprunner.com"
VITE_RUDDERSTACK_WRITE_KEY="36ajE1JfgkZdri3rm7K8zGyet30"
VITE_RUDDERSTACK_ENDPOINT="https://rudder-event-prod.stage.in"
```

**Status**: ✅ COMPLETE - All variables set in Amplify (as of 2026-02-12 15:58)

### Local Development (.env file)
**Location**: `tambola-frontend/.env`

**Purpose**: Local development only (gitignored)

**Current Values**:
```bash
VITE_API_URL="https://nhuh2kfbwk.ap-south-1.awsapprunner.com"
VITE_WS_URL="https://nhuh2kfbwk.ap-south-1.awsapprunner.com"
VITE_RUDDERSTACK_WRITE_KEY="36ajE1JfgkZdri3rm7K8zGyet30"
VITE_RUDDERSTACK_ENDPOINT="https://rudder-event-prod.stage.in"
```

**Status**: ✅ CORRECT

### Build Configuration
**Location**: `tambola-frontend/amplify.yml`

**Purpose**: Defines build steps for AWS Amplify

**Status**: ✅ CORRECT - Uses environment variables from Amplify Console

---

## Backend Configuration (tambola-backend)

### AWS App Runner Environment Variables
**Location**: AWS App Runner Service → Configuration → Environment Variables

**Current Production Values**:
```bash
# Database
DATABASE_URL="postgresql://[USERNAME]:[PASSWORD]@tambola-postgres-mumbai.crqimwgeu0u1.ap-south-1.rds.amazonaws.com:5432/tambola_db"

# Redis
REDIS_URL="redis://tambola-redis-mumbai.jnmrpn.0001.aps1.cache.amazonaws.com:6379"

# Security
JWT_SECRET="[REDACTED - 44 characters base64 string]"

# AWS Services
AWS_ACCESS_KEY_ID="[REDACTED - See AWS App Runner Console]"
AWS_SECRET_ACCESS_KEY="[REDACTED - See AWS App Runner Console]"
AWS_REGION="ap-south-1"
AWS_S3_BUCKET="tambola-promotional-images-mumbai"

# Application
NODE_ENV="production"
PORT="3000"
CORS_ORIGIN="http://localhost:5173,https://main.d262mxsv2xemak.amplifyapp.com"
```

**Status**: ✅ CORRECT

### Local Development (.env file)
**Location**: `tambola-backend/.env`

**Purpose**: Local development only (gitignored)

**Current Values**: Development database and Redis (localhost)

**Status**: ✅ CORRECT

---

## Critical Configuration Rules

### ✅ DO:
1. **Always set production values in AWS Amplify/App Runner Environment Variables**
2. **Keep .env files for local development only**
3. **Never commit .env files to git** (already in .gitignore)
4. **Update this document when changing production values**

### ❌ DON'T:
1. **Never hardcode credentials in code**
2. **Never rely on .env files for production deployments**
3. **Never commit secrets to git**

---

## Deployment Flow

### Frontend (Amplify)
1. Code pushed to GitHub
2. Amplify webhook triggers build
3. Amplify reads `amplify.yml` for build steps
4. **Environment variables injected from Amplify Console** during build
5. Built files deployed to CloudFront CDN

### Backend (App Runner)
1. Code pushed to GitHub
2. App Runner builds Docker image from Dockerfile
3. **Environment variables injected from App Runner Service Configuration** at runtime
4. Container deployed and serves traffic

---

## How to Update Configuration

### Frontend Variables:
```bash
aws amplify update-app \
  --app-id d262mxsv2xemak \
  --region ap-south-1 \
  --environment-variables \
    VITE_API_URL=https://nhuh2kfbwk.ap-south-1.awsapprunner.com,\
    VITE_WS_URL=https://nhuh2kfbwk.ap-south-1.awsapprunner.com,\
    VITE_RUDDERSTACK_WRITE_KEY=36ajE1JfgkZdri3rm7K8zGyet30,\
    VITE_RUDDERSTACK_ENDPOINT=https://rudder-event-prod.stage.in
```

Then trigger deployment:
```bash
aws amplify start-job \
  --app-id d262mxsv2xemak \
  --branch-name main \
  --job-type RELEASE \
  --region ap-south-1
```

### Backend Variables:
Use AWS Console → App Runner → Service → Configuration → Edit

Or via CLI (requires updating all vars at once).

---

## Verification

### Frontend:
```bash
# Check Amplify env vars
aws amplify get-app --app-id d262mxsv2xemak --region ap-south-1 \
  --query 'app.environmentVariables' --output json
```

### Backend:
```bash
# Check App Runner env vars
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:ap-south-1:637436419278:service/tambola-backend/d22a49b7907f45118cd1af314d9e0adc \
  --region ap-south-1 \
  --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables' \
  --output json
```

---

## Incident Log

### 2026-02-12: RudderStack 401 Errors
**Issue**: Analytics stopped working at 3:14 PM

**Root Cause**:
- Amplify environment variables only had RudderStack vars
- .env file had wrong RudderStack credentials
- Deployment at 3:14 PM used wrong credentials from .env

**Resolution**:
- Updated Amplify environment variables with correct credentials
- Updated .env file with correct credentials
- Redeployed at 3:52 PM

**Prevention**:
- Keep this document updated
- Always verify environment variables in AWS console match expected values
- Set ALL production variables in Amplify/App Runner, not just some
