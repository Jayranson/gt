# Visual Guide - Where to Paste Rules

## Firebase Console Has 2 Different Rules Editors

### 1. STORAGE Rules (For File Uploads)
```
URL: https://console.firebase.google.com/project/gaytradie-bdd1f/storage/rules

What you see:
┌────────────────────────────────────────────────────┐
│ Storage > Rules                         [Publish] │
├────────────────────────────────────────────────────┤
│                                                    │
│  [Code Editor - Paste storage.rules here]         │
│                                                    │
│  The editor should show:                          │
│  rules_version = '2';                             │
│  service firebase.storage {                       │
│    match /b/{bucket}/o {                          │
│      ...                                          │
│                                                    │
└────────────────────────────────────────────────────┘
```

**What to paste:** Everything from `storage.rules` file
**Where:** Delete ALL existing content, paste new content
**Then:** Click "Publish" button

---

### 2. FIRESTORE Rules (For Database)
```
URL: https://console.firebase.google.com/project/gaytradie-bdd1f/firestore/rules

What you see:
┌────────────────────────────────────────────────────┐
│ Firestore Database > Rules              [Publish] │
├────────────────────────────────────────────────────┤
│                                                    │
│  [Code Editor - Add verification rules here]      │
│                                                    │
│  The editor should show:                          │
│  rules_version = '2';                             │
│  service cloud.firestore {                        │
│    match /databases/{database}/documents {        │
│      match /artifacts/{appId}/public/data/... {   │
│        // ← ADD VERIFICATION RULES INSIDE HERE    │
│      }                                            │
│    }                                              │
│  }                                                │
│                                                    │
└────────────────────────────────────────────────────┘
```

**What to paste:** Add verification_requests match block INSIDE artifacts block
**Where:** Inside the `match /artifacts/{appId}/public/data/{document=**}` section
**Then:** Click "Publish" button

---

## Key Differences

| Feature | Storage Rules | Firestore Rules |
|---------|---------------|-----------------|
| **Purpose** | Controls file uploads/downloads | Controls database read/write |
| **Your Error** | ✅ This is causing your 403 error | ⚠️ Also needed but not causing current error |
| **URL** | .../storage/rules | .../firestore/rules |
| **File** | `storage.rules` | Add to existing Firestore rules |
| **Replace All?** | YES - Delete everything, paste new | NO - Add inside existing rules |

---

## The Confusion

You mentioned seeing "match /artifacts/{appId}/public/data/{document=**}" - that's FIRESTORE rules, not Storage rules.

**Storage rules** (what you need for uploads) are SEPARATE and look different.

You need to set up BOTH:
1. Storage rules (controls file uploads) ← **This is what's broken**
2. Firestore rules (controls database) ← Also needed

---

## Quick Check: Are Your Storage Rules Deployed?

Go to: https://console.firebase.google.com/project/gaytradie-bdd1f/storage/rules

If you see rules that start with `service firebase.storage`, you're in the right place.
If it's empty or has different rules, paste the content from `storage.rules` file.
