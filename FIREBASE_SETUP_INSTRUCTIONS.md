# Firebase Configuration Instructions

## Overview

The admin control panel requires Firebase Storage to be enabled and configured. Here's the complete setup guide.

## Current Setup

Your app currently initializes Firebase from `window.__firebase_config` (see App.tsx lines 68-75). If you already have a `main.tsx` with Firebase configuration, you need to ensure:

1. Firebase Storage is enabled
2. Security rules are deployed
3. Composite indexes are created

## Step-by-Step Configuration

### 1. Enable Firebase Storage

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Click **Storage** in the left sidebar
4. Click **Get Started**
5. Choose your security rules mode (we'll override these next)
6. Select a Cloud Storage location (same region as your Firestore if possible)
7. Click **Done**

### 2. Deploy Firestore Security Rules

1. In Firebase Console, go to **Firestore Database** → **Rules** tab
2. Replace the existing rules with the rules from `FIREBASE_SECURITY_RULES.md` (lines 10-80)
3. Click **Publish**

**Important sections to include:**
```javascript
// Verification Requests - special rules
match /verification_requests/{requestId} {
  allow create: if isAuthenticated();
  allow read: if isAdmin();
  allow update: if isAdmin();
  allow delete: if isAdmin();
}
```

### 3. Deploy Storage Security Rules

1. In Firebase Console, go to **Storage** → **Rules** tab
2. Replace with these rules:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
    }
    
    // Verification documents - encrypted storage
    match /verifications/{userId}/{fileName} {
      // Only the user can upload their own verification documents
      allow create: if request.auth != null && request.auth.uid == userId
                   && request.resource.size < 5 * 1024 * 1024  // Max 5MB
                   && request.resource.contentType.matches('image/.*');
      
      // Only admin can read verification documents
      allow read: if isAdmin();
      
      // Only admin can delete
      allow delete: if isAdmin();
    }
    
    // Profile images (if you add Firebase Storage for profile pics later)
    match /profiles/{userId}/{fileName} {
      allow create: if request.auth != null && request.auth.uid == userId
                   && request.resource.size < 5 * 1024 * 1024;
      allow read: if request.auth != null;
      allow update: if request.auth != null && request.auth.uid == userId;
      allow delete: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Click **Publish**

### 4. Create Firestore Composite Index

The admin panel queries verification requests by status and creation date. You need to create a composite index:

**Option A: Automatic (Recommended)**
1. Open the admin panel in your app after deployment
2. Try to view the Tradie Verification tab
3. If the index doesn't exist, you'll see an error in the console with a link
4. Click the link to auto-create the index in Firebase Console
5. Wait 1-2 minutes for the index to build

**Option B: Manual**
1. Go to Firebase Console → **Firestore Database** → **Indexes** tab
2. Click **Create Index**
3. Set:
   - **Collection ID**: `verification_requests`
   - **Fields to index**:
     - Field: `status`, Order: `Ascending`
     - Field: `createdAt`, Order: `Descending`
   - **Query scope**: `Collection`
4. Click **Create**
5. Wait for index to build (usually 1-2 minutes)

### 5. Your Configuration is Already Complete ✅

Good news! Your `main.tsx` already has the correct Firebase configuration:

```typescript
window.__firebase_config = JSON.stringify({
  apiKey: "AIzaSyBxkPiRXNSXnYUVHKhIP2MUNEYA-UEv10M",
  authDomain: "gaytradie-bdd1f.firebaseapp.com",
  projectId: "gaytradie-bdd1f",
  storageBucket: "gaytradie-bdd1f.firebasestorage.app", // ✅ Storage bucket configured
  messagingSenderId: "890637334556",
  appId: "1:890637334556:web:7b11e81de9dc89749887d9",
  measurementId: "G-KZCW87GNK7"
});
```

**Your setup is complete!** The App.tsx will automatically use this configuration.

### 6. Test the Setup

After deploying the rules and enabling storage:

1. **Test as Regular User (Tradie)**:
   - Login as a tradie user (not admin email)
   - Go to Profile
   - You should see a verification button if not already verified
   - Try uploading front and back of a CSCS/ECS card
   - Submit for review
   - Check Firebase Console → Storage to verify files uploaded

2. **Test as Admin**:
   - Login as `ranson.samsung@gmail.com`
   - You should see the shield icon in the header
   - Click shield to open admin panel
   - Go to "Tradie Verification" tab
   - You should see the pending request
   - Click the image to view full size
   - Try approving or rejecting

3. **Verify Security**:
   - Logout and login as non-admin user
   - Try to access admin panel directly (should show access denied)
   - Verify you cannot see other users' verification documents in Storage

## Common Issues

### Issue: "Firebase Storage not initialized"

**Solution**: 
- Verify Storage is enabled in Firebase Console
- Check that `storageBucket` is in your Firebase config
- Ensure `getStorage(app)` is called in initialization

### Issue: "Permission denied" when uploading

**Solution**:
- Verify Storage security rules are deployed
- Check that user is authenticated
- Ensure file size is under 5MB
- Verify file is an image format

### Issue: "Missing index" error in console

**Solution**:
- Click the link in the error message to create the index
- Or manually create the index as described in Step 4

### Issue: Admin can't see verification requests

**Solution**:
- Verify Firestore security rules include the `isAdmin()` function
- Verify you're logged in as `ranson.samsung@gmail.com`
- Check that composite index is created and built
- Check browser console for errors

### Issue: Storage bucket not found

**Solution**:
- Verify `storageBucket` is set in Firebase config
- Format should be: `your-project-id.appspot.com`
- Check Firebase Console → Project Settings → General for correct value

## Your Configuration Status ✅

Based on your `main.tsx`, you already have:
- ✅ Firebase config properly set with `storageBucket: "gaytradie-bdd1f.firebasestorage.app"`
- ✅ Window variables correctly set for App.tsx to use
- ✅ Project ID: `gaytradie-bdd1f`

**You only need to complete Steps 1-4 above:**
1. Enable Firebase Storage in Console (if not already enabled)
2. Deploy Firestore security rules
3. Deploy Storage security rules  
4. Create composite index

## Verification Checklist

After completing the 4 setup steps, verify:

- [ ] Firebase Storage enabled in Firebase Console (Project: gaytradie-bdd1f)
- [ ] Storage security rules deployed
- [ ] Firestore security rules deployed (including verification_requests)
- [ ] Composite index created and built (collection: verification_requests)
- [ ] Can upload verification as tradie
- [ ] Files appear in Storage under `verifications/{userId}/`
- [ ] Admin can see verification requests
- [ ] Admin can approve/reject verifications
- [ ] Non-admin users cannot access admin panel
- [ ] Non-admin users cannot view verification documents

## Security Notes

1. **Admin Email**: Only `ranson.samsung@gmail.com` can access admin features
2. **File Encryption**: Files are encrypted at rest by Firebase Storage
3. **Access Control**: Security rules prevent unauthorized access
4. **File Size**: Limited to 5MB per file
5. **File Types**: Only images allowed for verification documents

## Need More Help?

If you encounter issues:
1. Check browser console for error messages
2. Check Firebase Console → Storage → Files to verify uploads
3. Check Firebase Console → Firestore → Data to verify requests
4. Review `FIREBASE_SECURITY_RULES.md` for complete rules
5. Review `ADMIN_PANEL_GUIDE.md` for usage instructions

## Quick Reference

- **Admin Email**: `ranson.samsung@gmail.com`
- **Storage Path**: `verifications/{userId}/cscs_front_{timestamp}.jpg`
- **Firestore Collection**: `artifacts/{appId}/public/data/verification_requests`
- **File Size Limit**: 5MB
- **Index Collection**: `verification_requests`
- **Index Fields**: `status` (asc), `createdAt` (desc)
