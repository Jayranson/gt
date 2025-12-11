# Admin Control Panel - User Guide

## Overview

The Admin Control Panel is a secure administrative interface for managing the Gay Tradies platform. It is only accessible by the designated admin user (`ranson.samsung@gmail.com`).

## Features

### 1. Tradie Verification System ✅ (Fully Implemented)

The verification system allows tradies to submit their CSCS (Construction Skills Certification Scheme) or ECS (Electrotechnical Certification Scheme) cards for verification.

#### How It Works:

**For Tradies:**
1. Navigate to Profile
2. Click the verification badge/button (visible for unverified tradies)
3. Upload front and back photos of their CSCS/ECS card
4. Submit for review
5. Wait for admin approval

**For Admin:**
1. Click the shield icon in the header
2. Navigate to "Tradie Verification" tab
3. View pending verification requests
4. Click on a request to view full-size document images
5. Approve or Reject the verification
   - **Approve:** Sets tradie's `verified` status to `true` and adds verified badge
   - **Reject:** Marks request as rejected with a reason

#### Security Features:
- ✅ Documents uploaded to Firebase Storage (encrypted at rest)
- ✅ Only admin can view verification documents
- ✅ Access controlled via Firebase Security Rules
- ✅ File size limited to 5MB per document
- ✅ Verification requests stored in separate Firestore collection

### 2. Profile Picture Verification 🚧 (Placeholder)

This feature will allow admins to review and approve user profile pictures to ensure they comply with community guidelines.

**Status:** Coming in future update
- UI placeholder implemented
- Functionality to be added

### 3. Testing Tools ✅ (Implemented)

Developer tools for testing the application:
- Generate test users with GPS data
- Seed database with mock tradies and clients

## Access Control

### Admin Access
- **Admin Email:** `ranson.samsung@gmail.com`
- **Access Method:** Shield icon appears in header (top-right) when logged in as admin
- **Route:** `/admin` (automatically blocked for non-admin users)

### Non-Admin Users
- Shield icon is **hidden** in header
- Direct navigation to `/admin` shows "Access Denied" page
- Cannot view or modify verification requests
- Cannot access admin-only Firestore collections

## Data Structure

### Verification Requests Collection
```
artifacts/{appId}/public/data/verification_requests/{requestId}
```

Fields:
- `tradieUid` - User ID of the tradie
- `tradieName` - Name of the tradie
- `trade` - Trade type (Electrician, Plumber, etc.)
- `cardImageUrl` - URL to front of card in Firebase Storage
- `cardImageBackUrl` - URL to back of card in Firebase Storage
- `status` - "pending" | "approved" | "rejected"
- `createdAt` - Timestamp of submission
- `reviewedBy` - Admin UID who reviewed
- `reviewedAt` - Timestamp of review
- `rejectionReason` - (if rejected) Reason for rejection
- `notes` - Additional notes

### Storage Structure
```
verifications/{userId}/cscs_front_{timestamp}.jpg
verifications/{userId}/cscs_back_{timestamp}.jpg
```

## UI Components

### Admin Panel Tabs

1. **Tradie Verification**
   - Lists pending verification requests
   - Shows tradie name, trade, and submission date
   - Displays document preview (click to enlarge)
   - Approve/Reject buttons
   - Badge count shows number of pending requests

2. **Profile Pictures** (Placeholder)
   - Coming soon notice
   - Future feature for profile picture moderation

3. **Testing Tools**
   - Generate Test Users button
   - Creates mock tradies and clients with GPS data

### Verification Request Card

Each verification request shows:
- Tradie name and trade
- Submission date
- Document preview image
- Notes (if provided)
- Action buttons (Approve/Reject)
- "Pending" badge

### Full Image Modal

Click on document preview to view:
- Full-size document image
- Tradie details
- Quick approve/reject actions

## Workflow

### Tradie Verification Workflow

```
┌─────────────────┐
│  Tradie Submits │
│  Verification   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Upload to       │
│ Firebase Storage│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Request  │
│ in Firestore    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Admin Reviews   │
│ in Admin Panel  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│Approve │ │ Reject │
└───┬────┘ └───┬────┘
    │          │
    ▼          ▼
┌────────────────┐
│ Update Profile │
│ verified: true │
└────────────────┘
```

## Firebase Setup Required

### 1. Firestore Collections
Create these collections (they'll be auto-created on first use):
- `verification_requests`
- `profiles` (already exists)

### 2. Storage Buckets
Enable Firebase Storage and create path:
- `/verifications/{userId}/`

### 3. Security Rules
Apply rules from `FIREBASE_SECURITY_RULES.md`:
- Firestore rules for admin access
- Storage rules for document protection

### 4. Composite Indexes
Create in Firebase Console:
```
Collection: verification_requests
Fields: status (Ascending), createdAt (Descending)
```

## Admin Responsibilities

1. **Review Verification Requests Regularly**
   - Check admin panel daily for pending requests
   - Verify documents are legitimate CSCS/ECS cards
   - Approve or reject within 24-48 hours

2. **Document Quality Standards**
   - Check card is clearly visible
   - Verify expiration date is valid
   - Confirm name matches profile
   - Ensure card type matches trade

3. **Rejection Guidelines**
   Reject if:
   - Document is blurry or unreadable
   - Card is expired
   - Name doesn't match profile
   - Card type doesn't match claimed trade
   - Image appears doctored or fake

4. **Security Best Practices**
   - Don't share admin credentials
   - Review Firebase Security Rules regularly
   - Monitor for suspicious activity
   - Keep Firebase Console access secure

## Future Enhancements

### Planned Features:
1. **Profile Picture Verification**
   - Manual review of profile photos
   - Approve/reject inappropriate images
   - Set moderation flags

2. **Email Notifications**
   - Notify admin when new verification submitted
   - Notify tradie when verification approved/rejected

3. **Audit Logging**
   - Track all admin actions
   - Review history
   - Compliance reporting

4. **Bulk Actions**
   - Approve/reject multiple requests
   - Export verification reports

5. **Advanced Filtering**
   - Filter by trade type
   - Filter by date range
   - Search by name

6. **Auto-Cleanup**
   - Delete verification documents after 90 days
   - Archive approved/rejected requests

## Troubleshooting

### Admin Panel Not Showing
- Verify logged in as `ranson.samsung@gmail.com`
- Check Firebase Authentication
- Clear browser cache
- Check browser console for errors

### Verification Upload Fails
- Check Firebase Storage is enabled
- Verify Storage Security Rules are deployed
- Check file size (must be < 5MB)
- Ensure file is an image format

### Can't See Verification Requests
- Check Firestore Security Rules deployed
- Verify admin email is correct
- Check Firebase Console for requests
- Look for JavaScript errors in console

### Documents Not Loading
- Check Storage Security Rules
- Verify URLs are accessible to admin
- Check network tab for 403 errors
- Ensure Firebase Storage is properly configured

## Support

For technical issues or questions about the admin panel:
1. Check `FIREBASE_SECURITY_RULES.md` for setup
2. Review Firebase Console logs
3. Check browser console for errors
4. Contact development team

## Version History

- **v1.0** - Initial implementation
  - Admin access control
  - Tradie verification system
  - Firebase Storage integration
  - Security rules
  - Profile picture verification (placeholder)
