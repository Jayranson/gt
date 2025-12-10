# Quick Start - Firebase Setup for Admin Panel

## Your Configuration Status

✅ **Your `main.tsx` is already correctly configured!**

Your Firebase config includes:
- Project ID: `gaytradie-bdd1f`
- Storage Bucket: `gaytradie-bdd1f.firebasestorage.app`
- All required settings in place

## What You Need to Do (4 Simple Steps)

### Step 1: Enable Firebase Storage (2 minutes)

1. Go to https://console.firebase.google.com/project/gaytradie-bdd1f/storage
2. If you see "Get Started", click it
3. Accept default security rules (we'll override them next)
4. Choose storage location (same as your Firestore if possible)
5. Click "Done"

### Step 2: Deploy Storage Security Rules (3 minutes)

1. Go to https://console.firebase.google.com/project/gaytradie-bdd1f/storage/rules
2. Replace all existing rules with:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isAdmin() {
      return request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
    }
    
    match /verifications/{userId}/{fileName} {
      allow create: if request.auth != null && request.auth.uid == userId
                   && request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
      allow read: if isAdmin();
      allow delete: if isAdmin();
    }
  }
}
```

3. Click **Publish**

### Step 3: Update Firestore Security Rules (3 minutes)

1. Go to https://console.firebase.google.com/project/gaytradie-bdd1f/firestore/rules
2. Find the section with `match /artifacts/{appId}/public/data/{document=**}`
3. Add this **inside** that match block (before the closing brace):

```javascript
// Add this to your existing rules inside the artifacts match block
match /verification_requests/{requestId} {
  allow create: if request.auth != null;
  allow read: if request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
  allow update: if request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
  allow delete: if request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
}
```

4. Click **Publish**

### Step 4: Create Firestore Index (2 minutes)

**Option A - Automatic (Easiest):**
1. Deploy your app with the admin panel
2. Login as `ranson.samsung@gmail.com`
3. Click the shield icon → Go to Tradie Verification tab
4. You'll see an error with a link like "Create index"
5. Click the link, it will auto-create the index
6. Wait 1-2 minutes for it to build

**Option B - Manual:**
1. Go to https://console.firebase.google.com/project/gaytradie-bdd1f/firestore/indexes
2. Click **Create Index**
3. Enter:
   - Collection ID: `verification_requests`
   - Field 1: `status` → Ascending
   - Field 2: `createdAt` → Descending
4. Click **Create**
5. Wait for "Building" to change to "Enabled" (1-2 minutes)

## That's It! 🎉

Your admin panel is now ready to use. No code changes needed - your `main.tsx` already has everything configured correctly.

## Testing

1. **Test Tradie Verification Submission:**
   - Login as a tradie (any user except ranson.samsung@gmail.com)
   - Go to Profile
   - Upload CSCS/ECS card (front and back)
   - Submit for review

2. **Test Admin Panel:**
   - Login as `ranson.samsung@gmail.com`
   - Click shield icon in header
   - View pending verification requests
   - Approve or reject

## Need Help?

If something doesn't work:
1. Check browser console for errors
2. Verify you completed all 4 steps above
3. See `FIREBASE_SETUP_INSTRUCTIONS.md` for detailed troubleshooting
4. Check Firebase Console → Storage to see if files are uploading
5. Check Firebase Console → Firestore → Data to see verification requests

## Quick Links for Your Project

- Storage: https://console.firebase.google.com/project/gaytradie-bdd1f/storage
- Storage Rules: https://console.firebase.google.com/project/gaytradie-bdd1f/storage/rules
- Firestore Rules: https://console.firebase.google.com/project/gaytradie-bdd1f/firestore/rules
- Firestore Indexes: https://console.firebase.google.com/project/gaytradie-bdd1f/firestore/indexes
- Firestore Data: https://console.firebase.google.com/project/gaytradie-bdd1f/firestore/data
