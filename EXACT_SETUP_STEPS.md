# EXACT STEPS - Firebase Rules Setup

## Issue: Getting 403 Permission Denied Error

You're seeing this error because Firebase Storage rules aren't set up correctly yet. Let me give you EXACT steps.

---

## PART 1: Firebase Storage Rules (For Document Uploads)

### Step 1: Go to Storage Rules
1. Open this link: https://console.firebase.google.com/project/gaytradie-bdd1f/storage/rules
2. You should see a code editor with some existing rules

### Step 2: What You Should See
The screen should have:
- A tab that says "Rules" (you should be here)
- A code editor in the middle
- A "Publish" button at the top right

### Step 3: Delete Everything and Paste This EXACT Code

**IMPORTANT**: Delete ALL existing content in the editor first, then paste this:

**UPDATED RULES (Fixed 403 error):**

```
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
      allow read: if (request.auth != null && request.auth.uid == userId) || isAdmin();
      allow delete: if isAdmin();
    }
  }
}
```

**What changed:** Users can now read their own uploaded files (needed to get download URLs), and admin can read all files.

### Step 4: Click Publish
After pasting, click the "Publish" button in the top right corner.

### Step 5: Verify
You should see a green success message saying "Rules published successfully"

---

## PART 2: Firestore Database Rules (For Verification Requests)

### Step 1: Go to Firestore Rules
1. Open this link: https://console.firebase.google.com/project/gaytradie-bdd1f/firestore/rules
2. You should see a code editor with existing Firestore rules

### Step 2: Find the Right Place to Add Code

Look for a section that looks like this:
```
match /artifacts/{appId}/public/data/{document=**} {
  // ... some existing rules here ...
}
```

**If you DON'T see this section**, then use the complete rules from PART 2B below.

**If you DO see this section**, add the code from PART 2A below.

### PART 2A: If You Have Existing Rules

Find the line that looks like:
```
match /artifacts/{appId}/public/data/{document=**} {
```

INSIDE that section (before the closing `}`), add this code:

```
match /verification_requests/{requestId} {
  allow create: if request.auth != null;
  allow read: if request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
  allow update: if request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
  allow delete: if request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
}
```

### PART 2B: If You DON'T Have Existing Rules (Fresh Start)

If your Firestore rules are empty or very basic, DELETE EVERYTHING and paste this complete ruleset:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.email == 'ranson.samsung@gmail.com';
    }
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(uid) {
      return request.auth != null && request.auth.uid == uid;
    }
    
    match /artifacts/{appId}/public/data/{document=**} {
      allow read: if isAuthenticated();
      
      match /profiles/{userId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated() && isOwner(userId);
        allow update: if isAuthenticated() && isOwner(userId);
        allow delete: if isAdmin();
      }
      
      match /verification_requests/{requestId} {
        allow create: if isAuthenticated();
        allow read: if isAdmin();
        allow update: if isAdmin();
        allow delete: if isAdmin();
      }
      
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

### Step 3: Click Publish
After adding the code, click the "Publish" button.

---

## PART 3: Test the Upload

After completing both PART 1 and PART 2:

1. Go back to your app
2. Refresh the page
3. Try uploading verification documents again
4. The 403 error should be gone

---

## What Each Part Does

**Storage Rules (PART 1)**: Controls who can upload/download files in Firebase Storage
- Allows users to upload their own verification documents
- Only admin can view/delete verification documents

**Firestore Rules (PART 2)**: Controls who can read/write database records
- Allows users to create verification requests
- Only admin can read/approve/reject requests

---

## Still Getting Errors?

If you still see the 403 error after completing both parts:

1. Clear your browser cache and refresh
2. Check that you clicked "Publish" for BOTH Storage and Firestore rules
3. Make sure you're logged in with the correct email in the app
4. Wait 1-2 minutes for rules to propagate

The error message `Firebase Storage: User does not have permission to access 'verifications/...'` means Storage rules (PART 1) aren't deployed yet.
