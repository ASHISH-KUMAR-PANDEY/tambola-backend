# 🔄 Rollback Instructions

## Quick Rollback to v1.1.0-pre-flutter-bridge

If you need to rollback to the stable version before Flutter bridge implementation:

### Backend Rollback:
```bash
cd /Users/stageadmin/tambola-game/tambola-backend
git checkout v1.1.0-pre-flutter-bridge
gh workflow run deploy-backend.yml
```

### Frontend Rollback:
```bash
cd /Users/stageadmin/tambola-game/tambola-frontend
git checkout v1.1.0-pre-flutter-bridge
gh workflow run trigger-amplify-only.yml
```

### Return to Development:
```bash
# Backend
cd /Users/stageadmin/tambola-game/tambola-backend
git checkout main

# Frontend
cd /Users/stageadmin/tambola-game/tambola-frontend
git checkout main
```

## Version Info

**Tag:** `v1.1.0-pre-flutter-bridge`
**Date:** 2026-02-05
**Backend Commit:** 5f2f9e7
**Frontend Commit:** 2c50345

**Includes:**
- ✅ User name collection and display
- ✅ RudderStack analytics with app_user_id
- ✅ Winner names working correctly
- ✅ Auto-login via userId parameter
- ✅ CORS configured for production
