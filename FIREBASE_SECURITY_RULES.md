# Firebase Security Rules for Admin Control Panel

This document outlines the required Firebase Security Rules for the admin control panel and verification system.

## Firestore Security Rules

Add these rules to your `firestore.rules` file:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
    }
    
    // Helper function to check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Helper function to check if user owns the document
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }
    
    match /artifacts/{appId}/public/data/{document=**} {
      // Default read access for authenticated users
      allow read: if isAuthenticated();
      
      // Profiles - users can update their own profiles
      match /profiles/{userId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated() && isOwner(userId);
        allow update: if isAuthenticated() && isOwner(userId);
        allow delete: if isAdmin(); // Only admin can delete profiles
      }
      
      // Verification Requests - special rules
      match /verification_requests/{requestId} {
        // Anyone authenticated can create (tradies submitting verification)
        allow create: if isAuthenticated();
        
        // Only admin can read verification requests
        allow read: if isAdmin();
        
        // Only admin can update (approve/reject)
        allow update: if isAdmin();
        
        // Only admin can delete
        allow delete: if isAdmin();
      }
      
      // Jobs, messages, etc. - existing rules apply
      match /jobs/{jobId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated();
        allow update: if isAuthenticated();
      }
      
      match /messages/{messageId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated();
      }
      
      match /blocked_users/{blockId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated();
      }
      
      match /reports/{reportId} {
        allow read: if isAdmin();
        allow create: if isAuthenticated();
      }
      
      match /job_reviews/{reviewId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated();
      }
    }
  }
}
```

## Firebase Storage Security Rules

Add these rules to your `storage.rules` file:

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
      
      // Users can read their own files (needed to get download URLs), admin can read all
      allow read: if (request.auth != null && request.auth.uid == userId) || isAdmin();
      
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

## Important Security Notes

### 1. Admin Email Protection
- The admin email `ranson.samsung@gmail.com` is hardcoded in the application
- Only this email can access the admin panel
- Only this email can approve/reject verifications
- Consider moving this to Firebase Remote Config for easier updates

### 2. Document Encryption
- Files are uploaded to Firebase Storage with restricted access
- Only admins can view verification documents
- Files are stored in isolated paths per user
- File size is limited to 5MB per document
- **CRITICAL**: The file size limit in `storage.rules` (5MB) MUST match the `MAX_VERIFICATION_FILE_SIZE` constant in App.tsx (line 94)

### 3. Data Privacy
- Verification documents contain sensitive information (CSCS/ECS cards)
- Access is strictly controlled via security rules
- Consider implementing automatic deletion after verification (90 days)
- Add audit logging for admin actions

### 4. Verification Status Flow
```
User submits verification → Status: "pending"
Admin approves → Status: "approved" + Profile.verified = true
Admin rejects → Status: "rejected" + rejection reason stored
```

### 5. Recommended Enhancements
1. **Add composite indexes** for verification requests:
   ```
   Collection: verification_requests
   Fields: status (Ascending), createdAt (Descending)
   ```

2. **Set up Cloud Functions** for:
   - Email notifications to admin when new verification submitted
   - Email notifications to tradie when verification approved/rejected
   - Automatic cleanup of old verification documents

3. **Add audit logging** by creating an `admin_actions` collection:
   ```javascript
   {
     adminUid: string,
     adminEmail: string,
     action: 'approve' | 'reject',
     targetUid: string,
     timestamp: serverTimestamp(),
     details: object
   }
   ```

## Deployment Checklist

- [ ] Update Firestore security rules in Firebase Console
- [ ] Update Storage security rules in Firebase Console
- [ ] Create composite index for verification_requests
- [ ] Enable Firebase Storage in Firebase Console
- [ ] Test verification flow with test user
- [ ] Test admin panel access with admin email
- [ ] Test admin panel rejection with non-admin email
- [ ] Verify file upload size limits work correctly
- [ ] Test approve/reject functionality
- [ ] Set up monitoring for verification requests

## Testing the Setup

1. **Test as regular user:**
   - Should NOT see admin shield in header
   - Should be able to submit verification request
   - Should NOT be able to access /admin route directly

2. **Test as admin (ranson.samsung@gmail.com):**
   - Should see admin shield in header
   - Should see pending verification requests
   - Should be able to approve/reject verifications
   - Should be able to view uploaded documents

3. **Security test:**
   - Try accessing verification_requests collection directly (should fail for non-admin)
   - Try accessing verification files in Storage (should fail for non-admin)
   - Try updating another user's profile (should fail)
