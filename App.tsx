import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Hammer, Heart, User, MessageCircle, MapPin, 
  ShieldCheck, Search, Star, CheckCircle, 
  Briefcase, ArrowRight, X, DollarSign, 
  Settings, LogOut, Wrench, HardHat, Send, Edit2, Plus, Database,
  ClipboardList, AlertCircle, Camera, Filter, Image as ImageIcon, Navigation,
  Ban, Star as StarIcon, Flag, Phone, Lock, Mail, ShoppingBag, ShoppingCart, UploadCloud,
  Bell, Eye, EyeOff, Shield, UserX, Clock, Trash2, FileText, Info, 
  AlertTriangle, Users, BookOpen, ExternalLink, ChevronRight, Globe, UserCheck, Calendar,
  ChevronLeft, ChevronRight as ChevronRightIcon
} from 'lucide-react';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithCustomToken, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  deleteUser,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  onSnapshot,
  addDoc, 
  updateDoc, 
  deleteDoc,
  deleteField,
  serverTimestamp,
  query,
  orderBy, 
  limit,
  where,
  increment,
  arrayUnion,
  writeBatch
} from 'firebase/firestore';

// --- CONFIG & INIT ---
// Note: Firebase initialization is deferred to ensure window.__firebase_config is set
let app, auth, db;
let isFirebaseConfigured = false;

// Function to initialize Firebase (called after window variables are guaranteed to be set)
const initializeFirebase = () => {
    if (isFirebaseConfigured) return; // Already initialized
    
    try {
        const firebaseConfig = JSON.parse(typeof window.__firebase_config !== 'undefined' ? window.__firebase_config : '{}');
        
        // Check if Firebase config has required fields
        if (firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId) {
            app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
            isFirebaseConfigured = true;
            console.log("Firebase initialized successfully");
        }
    } catch (error) {
        console.error("Firebase initialization error:", error);
    }
};

const getAppId = () => {
    return typeof window.__app_id !== 'undefined' ? window.__app_id : 'gay-tradies-v2';
};

// --- CONSTANTS ---
const TRADES = [
    'Electrician', 'Plumber', 'Carpenter', 'Bricklayer', 'Landscaper', 'Roofer',
    'Painter & Decorator', 'Labourer', 'Other'
];
const PRIMARY_COLOR_TAILWIND = 'orange';
const MAX_VERIFICATION_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes
const BASE64_SIZE_RATIO = 0.75; // Base64 encoding increases size by ~33%, so actual size ≈ 75% of base64 length

// --- UTILS ---
const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 99999; 
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d < 0.01 ? 0 : d; 
};

// Get current time slot based on hour
const getCurrentTimeSlot = () => {
  const currentHour = new Date().getHours();
  
  if (currentHour >= 8 && currentHour < 12) {
    return 'morning';
  } else if (currentHour >= 12 && currentHour < 20) {
    return 'afternoon';
  } else if (currentHour >= 20 && currentHour < 23) {
    return 'evening';
  }
  
  return null;
};

// Format date as YYYY-MM-DD
const formatDateKey = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Get next available date and time for a tradie based on their work calendar
const getNextAvailableDateTime = (workCalendar) => {
  if (!workCalendar || Object.keys(workCalendar).length === 0) {
    return null; // No unavailability set
  }
  
  const now = new Date();
  const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Check the next 365 days to find first available slot
  for (let daysAhead = 0; daysAhead < 365; daysAhead++) {
    const checkDate = new Date(todayDateOnly);
    checkDate.setDate(todayDateOnly.getDate() + daysAhead);
    const dateKey = formatDateKey(checkDate);
    
    const dateSlots = workCalendar[dateKey];
    
    // Check each time slot for this date
    const timeSlots = ['morning', 'afternoon', 'evening'];
    for (const slot of timeSlots) {
      let isUnavailable = false;
      
      // Support both old format (array) and new format (object)
      if (dateSlots) {
        if (Array.isArray(dateSlots)) {
          isUnavailable = dateSlots.includes(slot);
        } else {
          isUnavailable = !!dateSlots[slot];
        }
      }
      
      if (!isUnavailable) {
        // Found an available slot!
        // If it's today, make sure the time slot hasn't passed
        if (daysAhead === 0) {
          const currentTimeSlot = getCurrentTimeSlot();
          const slotOrder = { morning: 0, afternoon: 1, evening: 2 };
          
          // If current slot is null (before 8am or after 11pm), next availability is morning
          if (currentTimeSlot === null) {
            if (slot === 'morning') {
              return { date: checkDate, timeSlot: slot, dateKey };
            }
            continue; // Skip slots before morning
          }
          
          // Only consider future slots today
          if (slotOrder[slot] <= slotOrder[currentTimeSlot]) {
            continue;
          }
        }
        
        return { date: checkDate, timeSlot: slot, dateKey };
      }
    }
  }
  
  // If we've checked 365 days and found nothing, they're unavailable indefinitely
  return null;
};

// Check if tradie is CURRENTLY unavailable (right now)
const isCurrentlyUnavailable = (workCalendar) => {
  if (!workCalendar || Object.keys(workCalendar).length === 0) {
    return false; // No unavailability set, so available
  }
  
  const now = new Date();
  const currentDateKey = formatDateKey(now);
  const currentTimeSlot = getCurrentTimeSlot();
  
  // If no current time slot (before 8am or after 11pm), consider available
  if (!currentTimeSlot) {
    return false;
  }
  
  const dateSlots = workCalendar[currentDateKey];
  if (!dateSlots) return false;
  
  // Support both old format (array) and new format (object)
  if (Array.isArray(dateSlots)) {
    return dateSlots.includes(currentTimeSlot);
  } else {
    return !!dateSlots[currentTimeSlot];
  }
};

// Get unavailability info for current time (reason and jobId if applicable)
const getCurrentUnavailabilityInfo = (workCalendar) => {
  if (!workCalendar || Object.keys(workCalendar).length === 0) {
    return null;
  }
  
  const now = new Date();
  const currentDateKey = formatDateKey(now);
  const currentTimeSlot = getCurrentTimeSlot();
  
  if (!currentTimeSlot) {
    return null;
  }
  
  const dateSlots = workCalendar[currentDateKey];
  if (!dateSlots) return null;
  
  // Support both old format (array) and new format (object)
  if (Array.isArray(dateSlots)) {
    return dateSlots.includes(currentTimeSlot) ? { reason: 'manual' } : null;
  } else {
    return dateSlots[currentTimeSlot] || null;
  }
};

// Format time slot for display
const formatTimeSlot = (timeSlot) => {
  const timeSlotMap = {
    morning: '8:00 AM',
    afternoon: '12:00 PM',
    evening: '8:00 PM'
  };
  return timeSlotMap[timeSlot] || '';
};

// --- UI PRIMITIVES ---
const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, ...props }) => {
  const baseStyle = "px-4 py-3 rounded-lg font-bold transition-all active:scale-95 flex items-center justify-center gap-2";
  const variants = {
    primary: "bg-slate-900 text-white hover:bg-slate-800",
    secondary: "bg-orange-500 text-white hover:bg-orange-600",
    outline: "border-2 border-slate-200 text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-red-500 text-white hover:bg-red-600",
    success: "bg-green-500 text-white hover:bg-green-600",
    disabled: "bg-slate-200 text-slate-400 cursor-not-allowed"
  };
  const variantStyle = disabled ? variants.disabled : variants[variant];
  return (
    <button 
      className={`${baseStyle} ${variantStyle} ${className}`} 
      onClick={disabled ? undefined : onClick} 
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

const Input = ({ label, textarea, ...props }) => (
  <div className="mb-4">
    {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
    {textarea ? (
      <textarea className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none" {...props} />
    ) : (
      <input className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none" {...props} />
    )}
  </div>
);

const Badge = ({ type, text, icon: Icon }) => {
  const styles = {
    verified: "bg-blue-100 text-blue-700 border-blue-200",
    trade: "bg-orange-100 text-orange-800 border-orange-200",
    locked: "bg-slate-100 text-slate-500 border-slate-200",
    distance: "bg-slate-800 text-white border-slate-900",
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200"
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 w-fit shadow-sm ${styles[type] || styles.trade}`}>
      {Icon && <Icon size={10} />}
      {type === 'verified' && !Icon && <ShieldCheck size={10} />}
      {type === 'locked' && !Icon && <AlertCircle size={10} />}
      {text}
    </span>
  );
};

const Avatar = ({ profile, size = 'md', className = '', blur = false, showEditIcon = false }) => {
    const sizeClasses = {
        sm: 'w-8 h-8',
        md: 'w-12 h-12',
        lg: 'w-24 h-24',
        xl: 'w-32 h-32' 
    };
    
    const blurClass = blur ? 'blur-md scale-110' : ''; 
    const hasPhoto = profile?.primaryPhoto || profile?.photo;

    const InnerContent = () => {
         if (hasPhoto) {
            return <img src={profile.primaryPhoto || profile.photo} alt={profile.name} className={`w-full h-full object-cover ${blurClass}`} />;
         }
         return (
             <div className={`w-full h-full flex items-center justify-center text-slate-400 bg-slate-200 ${blurClass} relative`}>
                 {profile?.role === 'tradie' ? <HardHat size={size === 'lg' || size === 'xl' ? 40 : 20} /> : <User size={size === 'lg' || size === 'xl' ? 40 : 20} />}
                 {showEditIcon && !hasPhoto && (
                     <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                         <Edit2 size={size === 'lg' || size === 'xl' ? 24 : 16} className="text-white" />
                     </div>
                 )}
             </div>
         );
    };

    return (
        <div className={`${sizeClasses[size]} rounded-full overflow-hidden border border-slate-100 ${className} relative`}>
            <InnerContent />
        </div>
    );
};

// --- COMPONENTS ---

// UPDATED: Cleaner Verified Badge, moved to avoid overlap
const VerifiedHardHat = () => (
    <div className="absolute top-1.5 right-1.5 z-20 bg-white rounded-full p-1 shadow-md border border-slate-100 flex items-center justify-center" title="Verified Tradie">
        <HardHat className="w-3 h-3 text-orange-600 fill-orange-200" />
    </div>
);

const ProfileTile = ({ profile, distanceKm, onOpenProfile, isCurrentUser, shouldBlur = false, hideDistance = false }) => {
    const isTradie = profile.role === 'tradie';
    const isVerified = profile.verified;
    const placeholderColor = isTradie ? 'bg-slate-800' : 'bg-slate-400';
    const photoUrl = profile.primaryPhoto || profile.photo || `https://placehold.co/400x400/${placeholderColor.replace('bg-', '')}/ffffff?text=${(profile.name || profile.username || 'U').charAt(0)}`;

    // Better distance display logic with privacy
    let distanceDisplay = 'Dist?';
    if (isCurrentUser) {
        distanceDisplay = 'You';
    } else if (hideDistance && !isCurrentUser) {
        // Show region only - safely handle location format
        if (profile.location) {
            const parts = profile.location.split(',');
            distanceDisplay = parts[0].trim() || 'Region';
        } else {
            distanceDisplay = 'Region';
        }
    } else if (distanceKm !== undefined && distanceKm < 9999) {
        if (distanceKm <= 0.1) {
            distanceDisplay = '<0.1 km';
        } else if (distanceKm < 1) {
            distanceDisplay = `${(distanceKm * 1000).toFixed(0)}m`;
        } else {
            distanceDisplay = `${distanceKm.toFixed(1)} km`;
        }
    }

    // Only blur if not viewing own profile
    const shouldApplyBlur = shouldBlur && !isCurrentUser;

    return (
        <button
            onClick={() => onOpenProfile(profile)}
            className={`w-full aspect-square relative overflow-hidden rounded-xl shadow-sm hover:shadow-xl transition-all border border-slate-200 group ${isCurrentUser ? 'ring-2 ring-orange-500 ring-offset-1' : ''}`}
        >
            <img
                src={photoUrl}
                alt={`${profile.name}'s profile`}
                className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${shouldApplyBlur ? 'blur-md scale-110' : ''}`}
                onError={(e) => { e.target.onerror = null; e.target.src = photoUrl; }}
            />
            
            {/* Blur Indicator */}
            {shouldApplyBlur && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-black/50 p-2 rounded-full text-white backdrop-blur-sm" title="Match to unblur">
                        <Lock size={20} />
                    </div>
                </div>
            )}
            
            {/* Verified Icon - Now Top Right */}
            {isTradie && isVerified && <VerifiedHardHat />}
            
            {/* Busy/DND Badge for Unavailable Tradies */}
            {isTradie && !isCurrentUser && (() => {
                const currentlyUnavailable = isCurrentlyUnavailable(profile.workCalendar);
                if (currentlyUnavailable) {
                    return (
                        <div className="absolute top-1.5 left-1.5 z-20 bg-red-500 text-white p-1 rounded-full shadow-md border border-white" title="Currently Unavailable">
                            <Ban size={12} />
                        </div>
                    );
                }
                return null;
            })()}

            {/* Overlay for distance and name */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-2">
                <div className='flex items-end justify-between w-full'>
                    <span className="text-white text-xs font-bold truncate text-left w-2/3 shadow-black drop-shadow-md">
                        {profile.name || profile.username}
                        {isCurrentUser && <span className='font-normal opacity-75 ml-1'>(You)</span>}
                    </span>
                    <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full shadow-sm ${isCurrentUser ? 'bg-green-600' : 'bg-orange-600'}`}>
                        {distanceDisplay}
                    </span>
                </div>
            </div>
        </button>
    );
};

const ProfileModal = ({ profile, distanceKm, onClose, onConnect, onMessage, hideDistance = false }) => {
    const isTradie = profile.role === 'tradie';
    const photoUrl = profile.primaryPhoto || profile.photo || `https://placehold.co/600x450/333333/ffffff?text=${(profile.name || 'User').charAt(0)}`;
    const [showBlockConfirm, setShowBlockConfirm] = useState(false);
    const [reviews, setReviews] = useState([]);

    // Fetch reviews for tradies
    useEffect(() => {
        if (!isTradie || !profile.uid || !db) return;
        
        const reviewsRef = collection(db, 'artifacts', getAppId(), 'public', 'data', 'job_reviews');
        const q = query(
            reviewsRef, 
            where('reviewedUid', '==', profile.uid),
            where('reviewerRole', '==', 'client'),
            orderBy('createdAt', 'desc'),
            limit(3)
        );
        
        const unsub = onSnapshot(q, (snapshot) => {
            const reviewData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setReviews(reviewData);
        });
        
        return () => unsub();
    }, [isTradie, profile.uid]);

    const handleBlock = async () => {
        try {
            // Get current user from auth
            const currentUser = auth?.currentUser;
            if (!currentUser || !db) return;

            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users'), {
                blockedBy: currentUser.uid,
                blockedUser: profile.uid,
                blockedUserName: profile.name || profile.username,
                blockedAt: serverTimestamp(),
                source: 'profile'
            });
            setShowBlockConfirm(false);
            onClose();
        } catch (error) {
            console.error("Error blocking user:", error);
        }
    };

    // Display distance with privacy - safely handle location format
    let locationDisplay = profile.location || 'Near you';
    if (hideDistance && distanceKm !== undefined && distanceKm < 9999) {
        // Show region only - safely parse location
        if (profile.location) {
            const parts = profile.location.split(',');
            locationDisplay = parts[0].trim() || 'Near you';
        } else {
            locationDisplay = 'Near you';
        }
    } else if (distanceKm !== undefined && distanceKm < 9999) {
        locationDisplay = `${distanceKm.toFixed(1)} km away`;
    }

    // Only blur photos if not viewing own profile
    const shouldBlurPhoto = profile.blurPhotos && auth?.currentUser?.uid !== profile.uid;

    return (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-end sm:items-center justify-center animate-in fade-in duration-200">
            <div className="bg-white w-full sm:w-[400px] h-[90vh] sm:h-auto sm:max-h-[80vh] sm:rounded-2xl rounded-t-2xl overflow-y-auto shadow-2xl relative flex flex-col">
                
                {/* Close Button */}
                <button onClick={onClose} className="absolute top-4 right-4 z-20 bg-black/40 hover:bg-black/60 text-white p-2 rounded-full backdrop-blur-sm transition-colors">
                    <X className="w-5 h-5" />
                </button>

                {/* Block Button */}
                <button
                    onClick={() => setShowBlockConfirm(true)}
                    className="absolute top-4 left-4 z-20 bg-black/40 hover:bg-black/60 text-white p-2 rounded-full backdrop-blur-sm transition-colors"
                    title="Block user"
                >
                    <Ban className="w-5 h-5" />
                </button>

                {/* Hero Image */}
                <div className="relative h-80 shrink-0">
                    <img
                        src={photoUrl}
                        alt="Profile"
                        className={`w-full h-full object-cover ${shouldBlurPhoto ? 'blur-md scale-110' : ''}`}
                    />
                    {shouldBlurPhoto && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-black/50 p-3 rounded-full text-white backdrop-blur-sm">
                                <Lock size={32} />
                            </div>
                        </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent p-6 flex flex-col justify-end">
                        <div className="flex items-center mb-1">
                            <h3 className="text-3xl font-extrabold text-white leading-tight mr-2">
                                {profile.name || profile.username}, {profile.age}
                            </h3>
                            {isTradie && profile.verified && <div className="bg-white rounded-full p-1"><HardHat className="w-4 h-4 text-orange-600" /></div>}
                        </div>
                        <p className="text-sm text-gray-300 flex items-center font-medium">
                            <MapPin className="w-4 h-4 mr-1 text-orange-500" />
                            {locationDisplay}
                        </p>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 overflow-y-auto">
                    <div className="flex flex-wrap gap-2 mb-6">
                        {isTradie && (
                            <Badge type="trade" text={`${profile.trade} ${profile.yearsExperience ? `(${profile.yearsExperience}+ Yrs)` : ''}`} />
                        )}
                        {profile.sexuality && (
                            <Badge type="distance" text={profile.sexuality} />
                        )}
                        {profile.lookingFor && (
                            <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-[10px] font-bold border border-green-200">
                                Looking for: {profile.lookingFor}
                            </span>
                        )}
                    </div>

                    <div className="mb-6">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Bio</h4>
                        <p className="text-slate-700 text-sm leading-relaxed">{profile.bio || 'No bio provided.'}</p>
                    </div>

                    {/* Not Available Banner for Tradies */}
                    {isTradie && (() => {
                        const currentlyUnavailable = isCurrentlyUnavailable(profile.workCalendar);
                        if (currentlyUnavailable) {
                            const unavailabilityInfo = getCurrentUnavailabilityInfo(profile.workCalendar);
                            const nextAvailable = getNextAvailableDateTime(profile.workCalendar);
                            const isOnJob = unavailabilityInfo?.reason === 'job';
                            
                            if (nextAvailable) {
                                return (
                                    <div className={`mb-6 border-2 rounded-xl p-4 ${isOnJob ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                                        <div className="flex items-center gap-2">
                                            <Ban size={18} className={isOnJob ? 'text-blue-600' : 'text-red-600'} />
                                            <div>
                                                <p className={`text-xs font-bold ${isOnJob ? 'text-blue-900' : 'text-red-900'}`}>
                                                    {isOnJob ? "On a job! I'll be available for Hire from:" : "Not Available for Hire until:"}
                                                </p>
                                                <p className={`text-sm font-black ${isOnJob ? 'text-blue-700' : 'text-red-700'}`}>
                                                    {nextAvailable.date.toLocaleDateString('en-GB', { 
                                                        weekday: 'short',
                                                        month: 'short', 
                                                        day: 'numeric',
                                                        year: 'numeric'
                                                    })} at {formatTimeSlot(nextAvailable.timeSlot)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                        }
                        return null;
                    })()}

                    {isTradie && (
                        <div className="p-4 bg-orange-50 rounded-xl mb-6 border border-orange-100">
                            <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center">
                                <HardHat className="w-4 h-4 mr-2 text-orange-600" /> Tradie Stats
                            </h4>
                            <div className="flex justify-between items-center text-sm text-slate-700 mb-2">
                                <span className="flex items-center text-slate-500"><StarIcon className="w-3 h-3 text-yellow-500 mr-1" /> Rating</span>
                                <span className="font-bold">{profile.rating?.toFixed(1) || '5.0'} ({profile.reviews || 0})</span>
                            </div>
                            <div className="flex justify-between items-center text-sm text-slate-700">
                                <span className="flex items-center text-slate-500"><DollarSign className="w-3 h-3 text-green-600 mr-1" /> Rate</span>
                                <span className="font-bold">£{profile.rate || '??'}/hr</span>
                            </div>
                        </div>
                    )}

                    {/* Reviews Section for Tradies */}
                    {isTradie && reviews.length > 0 && (
                        <div className="mb-6">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Reviews</h4>
                            <div className="space-y-3">
                                {reviews.map((review) => (
                                    <div key={review.id} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-1">
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <Star
                                                        key={star}
                                                        size={12}
                                                        className={star <= review.rating 
                                                            ? 'fill-orange-500 text-orange-500' 
                                                            : 'text-slate-300'
                                                        }
                                                    />
                                                ))}
                                            </div>
                                            <span className="text-xs text-slate-400">
                                                {review.createdAt?.toDate?.()?.toLocaleDateString() || 'Recently'}
                                            </span>
                                        </div>
                                        {review.comment && (
                                            <p className="text-xs text-slate-600 leading-relaxed">{review.comment}</p>
                                        )}
                                        <p className="text-xs text-slate-400 mt-1">- {review.reviewerName}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Footer Buttons */}
                <div className="p-4 border-t border-slate-100 grid grid-cols-2 gap-3 bg-white sticky bottom-0 z-10">
                    <Button onClick={() => onConnect(profile)} className="w-full bg-red-500 hover:bg-red-600 shadow-red-200 shadow-lg">
                        <Heart className="w-5 h-5" /> Connect
                    </Button>
                    <Button onClick={() => onMessage(profile)} variant="primary" className="w-full shadow-slate-200 shadow-lg">
                        <MessageCircle className="w-5 h-5" /> Message
                    </Button>
                </div>

                {/* Block Confirmation Modal */}
                {showBlockConfirm && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
                            <h3 className="text-lg font-bold text-slate-900 mb-2">Block User?</h3>
                            <p className="text-sm text-slate-600 mb-4">
                                You won't see this profile anymore and they won't be able to contact you.
                            </p>
                            <div className="flex gap-2">
                                <Button variant="ghost" className="flex-1" onClick={() => setShowBlockConfirm(false)}>
                                    Cancel
                                </Button>
                                <Button variant="danger" className="flex-1" onClick={handleBlock}>
                                    Block
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- TOAST NOTIFICATION COMPONENT ---
const Toast = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    const bg = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-slate-900';

    return (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 ${bg} text-white px-6 py-3 rounded-full shadow-lg z-[150] flex items-center gap-2 transition-all`}>
            {type === 'success' && <CheckCircle size={18} />}
            {type === 'error' && <AlertCircle size={18} />}
            <span className="font-bold text-sm">{message}</span>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [view, setView] = useState('landing'); 
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dating');
  const [selectedProfile, setSelectedProfile] = useState(null); 
  const [feedFilter, setFeedFilter] = useState(null); 
  const [acceptedTradieIds, setAcceptedTradieIds] = useState(new Set()); 
  const [chatBackView, setChatBackView] = useState('feed'); // Track where to go back from chat (default to feed)
  const [pendingJobsCount, setPendingJobsCount] = useState(0); // Count of pending job actions
  
  // Notification dots state (true = show red dot, false = hidden)
  const [hasJobsNotification, setHasJobsNotification] = useState(false);
  const [hasDiscoverNotification, setHasDiscoverNotification] = useState(false);
  const [hasProfileNotification, setHasProfileNotification] = useState(false);
  const [hasShopNotification, setHasShopNotification] = useState(false);
  
  // Toast State
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info') => {
      setToast({ message, type });
  };

  // Initialize Firebase on component mount
  useEffect(() => {
    initializeFirebase();
  }, []);

  // Auth Init
  useEffect(() => {
    if (!auth) {
        setLoading(false);
        // Firebase not configured - this is expected on first setup
        // Don't log error to avoid confusion
        return;
    }
    const initAuth = async () => {
      try {
        if (typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } else {
          console.log("No custom token found. User needs to sign up or login.");
          // Don't auto-sign in - let user explicitly sign up or login
        }
      } catch (error) {
        console.error("Authentication error:", error);
        showToast(`Authentication failed: ${error.message}. Check Firebase Console settings.`, "error");
        setLoading(false); // Stop loading on error
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      console.log("Auth state changed:", u ? `User ${u.uid}` : "No user");
      setUser(u);
      setLoading(false); // Auth completed - stop loading whether user exists or not
    });
    return () => unsubscribe();
  }, []);

  // GPS watch ID for continuous tracking
  const watchIdRef = useRef(null);

  // UPDATED: Function to manually trigger GPS update with continuous watching
  const updateLocation = () => {
      if (!navigator.geolocation || !user || !db) {
          showToast("Geolocation not supported", "error");
          return;
      }
      
      // Clear any existing watch
      if (watchIdRef.current !== null && typeof watchIdRef.current === 'number') {
          navigator.geolocation.clearWatch(watchIdRef.current);
      }
      
      showToast("Requesting GPS...", "info");
      
      const updatePosition = async (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          try {
              const userRef = doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid);
              await updateDoc(userRef, { 
                  latitude, 
                  longitude,
                  locationAccuracy: accuracy,
                  locationUpdatedAt: serverTimestamp()
              });
              showToast("Location updated!", "success");
          } catch (e) {
              console.error("Error updating location:", e);
              showToast("Database error", "error");
          }
      };
      
      const handleError = (error) => {
          console.warn("GPS Error:", error);
          let errorMsg = "Location access denied or failed";
          switch(error.code) {
              case error.PERMISSION_DENIED:
                  errorMsg = "Please allow location access in your browser";
                  break;
              case error.POSITION_UNAVAILABLE:
                  errorMsg = "Location information unavailable";
                  break;
              case error.TIMEOUT:
                  errorMsg = "Location request timed out";
                  break;
          }
          showToast(errorMsg, "error");
      };
      
      // Start continuous position watching
      watchIdRef.current = navigator.geolocation.watchPosition(
          updatePosition,
          handleError,
          { 
              enableHighAccuracy: true, 
              maximumAge: 30000, // Cache for 30 seconds
              timeout: 27000 
          }
      );
  };

  // Try to get real location on load with user interaction check
  useEffect(() => {
      if (user && db && navigator.geolocation) {
          // Try to get location once on load
          navigator.geolocation.getCurrentPosition(
              async (position) => {
                  const { latitude, longitude, accuracy } = position.coords;
                  try {
                      const userRef = doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid);
                      await updateDoc(userRef, { 
                          latitude, 
                          longitude,
                          locationAccuracy: accuracy,
                          locationUpdatedAt: serverTimestamp()
                      });
                  } catch (e) {
                      console.error("Error updating initial location:", e);
                  }
              },
              (error) => {
                  console.log("Initial GPS request blocked, waiting for user interaction:", error.message);
              },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
          );
      }
      
      // Cleanup watch on unmount
      return () => {
          if (watchIdRef.current !== null && typeof watchIdRef.current === 'number') {
              navigator.geolocation.clearWatch(watchIdRef.current);
          }
      };
  }, [user]);

  // Fetch Current User Profile
  useEffect(() => {
    if (!user || !db) return;
    const unsub = onSnapshot(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile(docSnap.data());
        // Only redirect to feed if we're on landing page AND profile just got created
        // This prevents navigation when updating profile from other views
        if (view === 'landing') setView('feed');
      } else {
        // Profile doesn't exist - go to onboarding (unless already on landing)
        if (view !== 'landing') setView('onboarding');
      }
      setLoading(false);
    }, (err) => console.error(err));
    return () => unsub();
  }, [user, view]); // Added view as dependency

  // Fetch Accepted Jobs (for Unblur Logic)
  useEffect(() => {
    if (!user || !db) return;
    const q = query(
        collection(db, 'artifacts', getAppId(), 'public', 'data', 'jobs'), 
        where('clientUid', '==', user.uid),
        where('status', '==', 'Accepted')
    );
    const unsub = onSnapshot(q, (snapshot) => {
        const trustedIds = new Set();
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.tradieUid) trustedIds.add(data.tradieUid);
        });
        setAcceptedTradieIds(trustedIds);
    });
    return () => unsub();
  }, [user]);

  // Set Profile notification if email not verified
  useEffect(() => {
    if (user && !user.emailVerified) {
      setHasProfileNotification(true);
    } else {
      setHasProfileNotification(false);
    }
  }, [user]);

  // View Routing
  const renderView = () => {
    if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div></div>;

    // Check if Firebase is configured
    if (!auth || !db) {
      return (
        <div className="h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="max-w-lg bg-white rounded-lg shadow-lg p-8 border-l-4 border-orange-500">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="text-orange-500" size={32} />
              <h2 className="text-2xl font-bold text-slate-900">Firebase Configuration Required</h2>
            </div>
            <div className="space-y-4 text-slate-700">
              <p>The app is running, but Firebase hasn't been configured yet.</p>
              <div className="bg-slate-50 p-4 rounded-md">
                <p className="font-semibold mb-2">To set up Firebase:</p>
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  <li>Go to <a href="https://console.firebase.google.com/" target="_blank" className="text-orange-600 hover:underline">Firebase Console</a></li>
                  <li>Create a new project (or use existing)</li>
                  <li>Enable <strong>Authentication</strong> → Anonymous provider</li>
                  <li>Enable <strong>Firestore Database</strong> (test mode)</li>
                  <li>Copy your Firebase config to <code className="bg-slate-200 px-1 rounded">src/main.tsx</code></li>
                </ol>
              </div>
              <p className="text-sm text-slate-600">
                See <strong>LOCAL_SETUP.md</strong> in the repository for detailed instructions.
              </p>
            </div>
          </div>
        </div>
      );
    }

    switch (view) {
      case 'landing': return <LandingPage onLogin={() => setView('onboarding')} />;
      case 'onboarding': return <Onboarding user={user} onComplete={() => setView('feed')} />;
      case 'feed': return <Feed user={user} userProfile={userProfile} activeTab={activeTab} setActiveTab={setActiveTab} filter={feedFilter} clearFilter={() => setFeedFilter(null)} onMessage={(p) => { setSelectedProfile(p); setChatBackView('feed'); setView('chat'); }} onRequestJob={(p) => { setSelectedProfile(p); setView('requestJob'); }} acceptedTradieIds={acceptedTradieIds} onEnableLocation={updateLocation} showToast={showToast} />;
      case 'services': return <ServiceFinder onSelectService={(trade) => { setFeedFilter(trade); setView('feed'); }} onPostJob={() => setView('postJobAdvert')} />;
      case 'postJobAdvert': return <PostJobAdvert user={user} onCancel={() => setView('services')} onSuccess={() => { setView('jobs'); showToast("Advert Posted!", "success"); }} />;
      case 'messages': return <ChatList user={user} onSelectChat={(p) => { setSelectedProfile(p); setChatBackView('messages'); setView('chat'); }} />;
      case 'chat': return <ChatRoom user={user} partner={selectedProfile} onBack={() => setView(chatBackView)} />;
      case 'requestJob': return <JobRequestForm user={user} tradie={selectedProfile} onCancel={() => setView('feed')} onSuccess={() => { setView('jobs'); showToast("Request Sent!", "success"); }} />;
      case 'jobs': return <JobManager user={user} userProfile={userProfile} onPendingCountChange={(count) => { setPendingJobsCount(count); setHasJobsNotification(count > 0); }} />;
      case 'shop': return <Shop user={user} showToast={showToast} onCartChange={(count) => setHasShopNotification(count > 0)} />;
      case 'profile': return <UserProfile user={user} profile={userProfile} onLogout={async () => { 
        try {
          await auth.signOut();
          setView('landing');
          setUserProfile(null);
          showToast("Signed out successfully", "success");
        } catch (error) {
          console.error("Sign out error:", error);
          showToast("Failed to sign out", "error");
        }
      }} showToast={showToast} onEnableLocation={updateLocation} onNavigate={setView} />;
      case 'settings': return <SettingsScreen user={user} profile={userProfile} onBack={() => setView('profile')} showToast={showToast} />;
      case 'workCalendar': return <WorkCalendar user={user} profile={userProfile} onBack={() => setView('profile')} showToast={showToast} />;
      case 'paymentsCredits': return <PaymentsCredits user={user} profile={userProfile} onBack={() => setView('profile')} showToast={showToast} />;
      case 'safety': return <SafetyCentre user={user} onBack={() => setView('profile')} showToast={showToast} />;
      case 'admin': return <AdminPanel user={user} onBack={() => setView('profile')} showToast={showToast} />;
      default: return <Feed user={user} activeTab={activeTab} setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 max-w-md mx-auto shadow-2xl overflow-hidden relative border-x border-slate-200 flex flex-col">
      {/* Notifications */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      {view !== 'landing' && view !== 'onboarding' && (
        <header className="bg-slate-900 text-white p-4 sticky top-0 z-50 flex justify-between items-center shadow-md h-16">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('feed')}>
            <HardHat className="text-orange-500 fill-orange-500" size={24} />
            <h1 className="font-bold text-xl tracking-tight">Gay<span className="text-orange-500">Tradies</span></h1>
          </div>
          <div className="flex gap-3">
             <button onClick={() => setView('admin')} className="p-1 hover:bg-slate-700 rounded text-slate-400">
               <ShieldCheck size={18} />
             </button>
             <button className="relative p-1 hover:bg-slate-700 rounded transition-colors" onClick={() => setView('messages')}>
               <MessageCircle size={24} />
             </button>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-20 scrollbar-hide">
        {renderView()}
      </main>

      {/* Nav */}
      {view !== 'landing' && view !== 'onboarding' && view !== 'chat' && (
        <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-slate-200 flex justify-around p-2 pb-5 z-40 text-xs font-medium text-slate-500 shadow-[0_-5px_10px_rgba(0,0,0,0.05)]">
          <NavButton 
            icon={Search} 
            label="Discover" 
            active={view === 'feed'} 
            onClick={() => { setView('feed'); setHasDiscoverNotification(false); }} 
            hasNotification={hasDiscoverNotification}
          />
          <NavButton 
            icon={Wrench} 
            label="Services" 
            active={view === 'services'} 
            onClick={() => setView('services')} 
          />
          <NavButton 
            icon={Briefcase} 
            label="Jobs" 
            active={view === 'jobs'} 
            onClick={() => { setView('jobs'); setHasJobsNotification(false); }} 
            hasNotification={hasJobsNotification}
          />
          <NavButton 
            icon={ShoppingBag} 
            label="Shop" 
            active={view === 'shop'} 
            onClick={() => { setView('shop'); setHasShopNotification(false); }} 
            hasNotification={hasShopNotification}
          />
          <NavButton 
            icon={User} 
            label="Profile" 
            active={view === 'profile'} 
            onClick={() => { setView('profile'); setHasProfileNotification(false); }} 
            hasNotification={hasProfileNotification}
          />
        </nav>
      )}
    </div>
  );
}

const NavButton = ({ icon: Icon, label, active, onClick, hasNotification }) => (
  <button 
    onClick={onClick}
    className={`flex flex-col items-center gap-1 transition-all duration-300 relative ${active ? 'text-orange-600 scale-105' : 'hover:text-slate-800'}`}
  >
    <div className="relative">
      <Icon size={24} strokeWidth={active ? 2.5 : 2} />
      {hasNotification && (
        <span className="absolute -top-0.5 -right-0.5 bg-red-500 rounded-full w-2 h-2"></span>
      )}
    </div>
    <span className={active ? 'font-bold' : ''}>{label}</span>
  </button>
);

// --- VIEW COMPONENTS ---

const LandingPage = ({ onLogin }) => {
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [userType, setUserType] = useState('admirer');
  const [isOver18, setIsOver18] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getPasswordStrength = (pwd) => {
    if (!pwd) return { strength: 0, label: '', color: '' };
    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
    if (/\d/.test(pwd)) strength++;
    if (/[^A-Za-z0-9]/.test(pwd)) strength++;
    
    if (strength <= 2) return { strength, label: 'Weak', color: 'bg-red-500' };
    if (strength <= 3) return { strength, label: 'Fair', color: 'bg-yellow-500' };
    if (strength <= 4) return { strength, label: 'Good', color: 'bg-blue-500' };
    return { strength, label: 'Strong', color: 'bg-green-500' };
  };

  const handleSignUp = async () => {
    setError('');
    
    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    if (!isOver18) {
      setError('You must be 18+ to use this service');
      return;
    }
    
    if (!acceptTerms) {
      setError('You must accept Terms & Privacy Policy');
      return;
    }
    
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // Send email verification
      await sendEmailVerification(userCredential.user);
      
      // Store user type for onboarding
      localStorage.setItem('pendingUserType', userType);
      
      onLogin();
    } catch (err) {
      console.error('Sign up error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Email already in use. Try logging in instead.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else if (err.code === 'auth/weak-password') {
        setError('Password is too weak');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError('');
    
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged will handle navigation
    } catch (err) {
      console.error('Login error:', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError('Invalid email or password');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    
    if (!resetEmail) {
      setError('Please enter your email address');
      return;
    }
    
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      alert('Password reset email sent! Check your inbox.');
      setShowForgotPassword(false);
      setResetEmail('');
    } catch (err) {
      console.error('Password reset error:', err);
      if (err.code === 'auth/user-not-found') {
        setError('No account found with this email');
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = getPasswordStrength(password);

  if (showForgotPassword) {
    return (
      <div className="h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-slate-800 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-2xl font-bold mb-2">Reset Password</h2>
          <p className="text-slate-400 text-sm mb-6">Enter your email to receive a password reset link.</p>
          
          <Input
            label="Email"
            type="email"
            value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
            placeholder="your@email.com"
          />
          
          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
          
          <div className="flex gap-2 mt-6">
            <Button 
              variant="ghost" 
              className="flex-1" 
              onClick={() => { setShowForgotPassword(false); setError(''); }}
            >
              Back
            </Button>
            <Button 
              variant="secondary" 
              className="flex-1" 
              onClick={handleForgotPassword}
              disabled={loading}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #f97316 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
      
      <div className="z-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 animate-in fade-in zoom-in duration-500">
          <div className="bg-orange-500 p-4 rounded-2xl mb-4 shadow-[0_0_30px_rgba(249,115,22,0.5)]">
            <HardHat size={48} className="text-white fill-white" />
          </div>
          <h1 className="text-4xl font-extrabold mb-2 tracking-tight">Gay<span className="text-orange-500">Tradies</span></h1>
          <p className="text-slate-400 text-sm font-medium">Verified tradesmen & the men who want them.</p>
        </div>

        {/* Auth Form */}
        <div className="bg-slate-800 rounded-2xl p-8 shadow-2xl animate-in slide-in-from-bottom duration-500">
          <div className="flex bg-slate-700 rounded-lg p-1 mb-6">
            <button
              onClick={() => { setIsSignUp(true); setError(''); }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all ${
                isSignUp ? 'bg-orange-500 text-white' : 'text-slate-400'
              }`}
            >
              Sign Up
            </button>
            <button
              onClick={() => { setIsSignUp(false); setError(''); }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-bold transition-all ${
                !isSignUp ? 'bg-orange-500 text-white' : 'text-slate-400'
              }`}
            >
              Login
            </button>
          </div>

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          {isSignUp && (
            <>
              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />

              {password && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Password Strength</span>
                    <span className="font-bold">{passwordStrength.label}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                      style={{ width: `${(passwordStrength.strength / 5) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-bold text-slate-300 mb-2">I am a...</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUserType('tradie')}
                    className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                      userType === 'tradie' 
                        ? 'bg-orange-500 text-white' 
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                    }`}
                  >
                    Tradie
                  </button>
                  <button
                    onClick={() => setUserType('admirer')}
                    className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                      userType === 'admirer' 
                        ? 'bg-orange-500 text-white' 
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                    }`}
                  >
                    Admirer
                  </button>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isOver18}
                    onChange={(e) => setIsOver18(e.target.checked)}
                    className="w-4 h-4 rounded accent-orange-500"
                  />
                  <span className="text-sm text-slate-300">I confirm I am 18+</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    className="w-4 h-4 rounded accent-orange-500"
                  />
                  <span className="text-sm text-slate-300">I accept Terms & Privacy Policy</span>
                </label>
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-400 text-sm p-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <Button
            variant="secondary"
            className="w-full text-lg py-4 mb-3"
            onClick={isSignUp ? handleSignUp : handleLogin}
            disabled={loading}
          >
            {loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Login'}
          </Button>

          {!isSignUp && (
            <button
              onClick={() => setShowForgotPassword(true)}
              className="w-full text-sm text-orange-400 hover:text-orange-300 transition-colors"
            >
              Forgot password?
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Onboarding = ({ user, onComplete }) => {
  const [role, setRole] = useState(() => {
    // Get role from localStorage if available (set during signup)
    const pendingType = localStorage.getItem('pendingUserType');
    if (pendingType) {
      localStorage.removeItem('pendingUserType');
      return pendingType;
    }
    return 'admirer';
  });
  const [formData, setFormData] = useState({ name: '', age: '', location: '', trade: '', bio: '', rate: '', sexuality: 'Gay', lookingFor: 'All' });

  const handleSubmit = async () => {
    if (!formData.name) {
      alert("Please enter your name");
      return;
    }
    
    // Check if user is authenticated
    if (!user) {
      alert("Authentication Error:\n\nStill waiting for authentication to complete.\n\nIf this persists:\n1. Check your Firebase Console → Authentication → Sign-in method\n2. Verify 'Anonymous' provider is enabled\n3. Check browser console (F12) for error messages\n4. Try refreshing the page");
      console.error("User is not authenticated yet. user:", user);
      return;
    }
    
    if (!db) {
      alert("Database error: Firebase is not initialized. Check your Firebase configuration in src/main.tsx");
      return;
    }
    
    // Try to get GPS coordinates before creating profile
    let gpsCoords = { latitude: null, longitude: null };
    
    if (navigator.geolocation) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
          });
        });
        gpsCoords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          locationAccuracy: position.coords.accuracy,
          locationUpdatedAt: serverTimestamp()
        };
      } catch (error) {
        console.log("GPS not available during onboarding:", error.message);
      }
    }
    
    try {
      await setDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), {
        ...formData,
        role,
        uid: user.uid,
        verified: false,
        joinedAt: serverTimestamp(),
        reviews: 0,
        rating: 5.0,
        primaryPhoto: null,
        ...gpsCoords
      });
      onComplete();
    } catch (error) {
      console.error("Error creating profile:", error);
      alert("Failed to create profile. Please check your Firebase configuration and try again.");
    }
  };

  return (
    <div className="p-6 pt-8">
      <h2 className="text-3xl font-black mb-2 text-slate-900">Welcome aboard.</h2>
      <p className="text-slate-500 mb-8 font-medium">Tell us who you are.</p>
      <div className="flex gap-4 mb-8">
        <button onClick={() => setRole('admirer')} className={`flex-1 p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${role === 'admirer' ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-md' : 'border-slate-200 text-slate-400'}`}>
          <User size={32} /> <span className="font-bold">Client / Admirer</span>
        </button>
        <button onClick={() => setRole('tradie')} className={`flex-1 p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${role === 'tradie' ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-md' : 'border-slate-200 text-slate-400'}`}>
          <HardHat size={32} /> <span className="font-bold">Tradie</span>
        </button>
      </div>
      <div className="space-y-4">
        <Input label="Display Name" placeholder="e.g. Dave" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
        <div className="flex gap-4">
          <Input label="Age" type="number" placeholder="25" className="w-full" value={formData.age} onChange={e => setFormData({...formData, age: e.target.value})} />
          <Input label="City" placeholder="London" className="w-full" value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} />
        </div>
        {role === 'tradie' && (
          <>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-1">Your Trade</label>
              <select className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500" value={formData.trade} onChange={e => setFormData({...formData, trade: e.target.value})}>
                <option value="">Select a trade...</option>
                {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <Input label="Hourly Rate (£)" type="number" placeholder="45" value={formData.rate} onChange={e => setFormData({...formData, rate: e.target.value})} />
          </>
        )}
        <Input label="Bio" textarea rows={3} placeholder={role === 'tradie' ? "Experienced with tools. Looking for jobs or fun." : "Looking for a reliable tradie for work..."} value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} />
        <Button onClick={handleSubmit} className="w-full py-4 mt-4" variant="secondary" disabled={!user}>
          {user ? 'Create Profile' : 'Waiting for authentication...'}
        </Button>
        {!user && (
          <p className="text-xs text-slate-500 text-center mt-2">
            Please wait a moment while we set up your session...
          </p>
        )}
      </div>
    </div>
  );
};

const Feed = ({ user, userProfile, activeTab, setActiveTab, onMessage, onRequestJob, filter, clearFilter, acceptedTradieIds, onEnableLocation, showToast }) => {
  const [profiles, setProfiles] = useState([]);
  const [blockedUserIds, setBlockedUserIds] = useState(new Set());
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  
  // Logic from GT2: Social Filtering State
  const [socialFilter, setSocialFilter] = useState({
        verified: false,
        trade: '',
        distance: 100,
        minAge: 18,
        maxAge: 99,
  });
  const [selectedSocialProfile, setSelectedSocialProfile] = useState(null);

  // Hiring Filter State (Existing GT1 Logic)
  const [manualLocation, setManualLocation] = useState('');

  // Load blocked users
  useEffect(() => {
    if (!user || !db) return;
    const unsub = onSnapshot(
      collection(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users'),
      (snapshot) => {
        const blocked = new Set();
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          // Only add users I blocked (not users who blocked me)
          if (data.blockedBy === user.uid) {
            blocked.add(data.blockedUser);
          }
        });
        setBlockedUserIds(blocked);
      }
    );
    return () => unsub();
  }, [user]);

  // Combined Data Fetching
  useEffect(() => {
    if (!db) return;
    const q = collection(db, 'artifacts', getAppId(), 'public', 'data', 'profiles');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let allProfiles = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
      
      // Filter out blocked users
      allProfiles = allProfiles.filter(p => !blockedUserIds.has(p.uid));
      
      // Apply incognito mode - hide profiles with incognito enabled
      // This hides the profile from all feeds including user's own feed
      allProfiles = allProfiles.filter(p => !p.incognitoMode);
      
      // Apply job-only visibility filter for social tab
      // Users with jobOnlyVisibility should only appear in hiring tab, not social
      if (activeTab === 'dating') {
        allProfiles = allProfiles.filter(p => !p.jobOnlyVisibility);
      }
      
      // Calculate distances for all profiles first
      if (userProfile?.latitude && userProfile?.longitude) {
          allProfiles = allProfiles.map(p => {
              const dist = getDistanceFromLatLonInKm(
                  userProfile.latitude, userProfile.longitude,
                  p.latitude, p.longitude
              );
              return { ...p, distanceKm: dist };
          });
      }

      setProfiles(allProfiles);
    });
    return () => unsubscribe();
  }, [userProfile, blockedUserIds, activeTab, user]);


  // GT2 Logic: Memoized Filter & Sort for Social Tab
  const filteredSocialProfiles = useMemo(() => {
      return profiles
        .filter(p => p.role !== 'admin')
        .filter(p => !socialFilter.verified || p.verified)
        .filter(p => !socialFilter.trade || p.trade === socialFilter.trade)
        .filter(p => p.age >= socialFilter.minAge && p.age <= socialFilter.maxAge)
        .filter(p => !p.distanceKm || p.distanceKm <= socialFilter.distance)
        // Apply user's "Verified Only" privacy setting
        .filter(p => {
            if (p.uid === user?.uid) return true; // Always show current user
            if (!userProfile?.verifiedOnly) return true; // Setting not enabled
            return p.verified === true; // Only show verified profiles
        })
        .sort((a, b) => {
            // Current user's profile always appears first
            if (a.uid === user?.uid) return -1;
            if (b.uid === user?.uid) return 1;
            // Then sort ASCENDING by distance so CLOSEST profiles appear at TOP
            const aDist = a.distanceKm || 99999;
            const bDist = b.distanceKm || 99999;
            return aDist - bDist; // Smaller distances first (top), larger distances last (bottom)
        });
  }, [profiles, socialFilter, user, userProfile]);

  // Hiring Filter Logic (GT1)
  const filteredHiringProfiles = useMemo(() => {
      let result = profiles.filter(p => p.uid !== user?.uid);
      if (filter) result = result.filter(p => p.trade === filter);
      if (manualLocation.trim()) {
          const search = manualLocation.toLowerCase();
          result = result.filter(p => p.location?.toLowerCase().includes(search));
      }
      
      // Filter out tradies who are unavailable at the current time
      const currentDateKey = formatDateKey(new Date());
      const currentTimeSlot = getCurrentTimeSlot();
      
      // Filter out unavailable tradies (use 'morning' as default for off-hours)
      const effectiveTimeSlot = currentTimeSlot || 'morning';
      result = result.filter(p => {
          const workCalendar = p.workCalendar || {};
          const dateSlots = workCalendar[currentDateKey];
          
          if (!dateSlots) return true; // Available if no slots defined for today
          
          // Support both old format (array) and new format (object)
          if (Array.isArray(dateSlots)) {
              return !dateSlots.includes(effectiveTimeSlot);
          } else {
              return !dateSlots[effectiveTimeSlot];
          }
      });
      
      // Sort: Verified first for hiring, then distance
      result.sort((a, b) => {
          if (a.verified !== b.verified) return b.verified ? 1 : -1;
          return (a.distanceKm || 9999) - (b.distanceKm || 9999);
      });
      return result;
  }, [profiles, filter, manualLocation, user]);

  const handleFilterChange = (e) => {
      const { name, value, type, checked } = e.target;
      setSocialFilter(prev => ({
          ...prev,
          [name]: type === 'checkbox' ? checked : value
      }));
  };

  const handleConnect = (profile) => {
      setSelectedSocialProfile(null);
      onMessage(profile);
  };

  return (
    <div className="p-4">
      {/* Email Verification Banner */}
      {user && !user.emailVerified && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4 mb-4 animate-in slide-in-from-top duration-300">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-orange-600 mt-0.5 flex-shrink-0" size={20} />
            <div className="flex-1">
              <h3 className="font-bold text-orange-900 text-sm mb-1">Verify your email to unlock full features</h3>
              <p className="text-orange-700 text-xs mb-2">
                Check your inbox for a verification link. Jobs and messages are limited until verified.
              </p>
              <button
                onClick={async () => {
                  if (isCheckingVerification) return;
                  
                  setIsCheckingVerification(true);
                  try {
                    // Reload user to get latest verification status
                    await user.reload();
                    const updatedUser = auth.currentUser;
                    
                    if (updatedUser && updatedUser.emailVerified) {
                      showToast?.('Email verified successfully!', 'success');
                      // The UI will update automatically as the auth state changes
                      return;
                    }
                    
                    // Still not verified, send another email
                    await sendEmailVerification(user);
                    showToast?.('Verification email sent! Check your inbox.', 'success');
                  } catch (err) {
                    console.error('Error with verification:', err);
                    if (err.code === 'auth/too-many-requests') {
                      showToast?.('Too many requests. Please wait a few minutes.', 'error');
                    } else {
                      showToast?.('Failed to send email. Try again later.', 'error');
                    }
                  } finally {
                    setIsCheckingVerification(false);
                  }
                }}
                disabled={isCheckingVerification}
                className="text-xs font-bold text-orange-600 hover:text-orange-700 underline disabled:opacity-50"
              >
                {isCheckingVerification ? 'Checking...' : 'Resend verification email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle Header */}
      <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200 mb-6 sticky top-0 z-30">
        <button onClick={() => setActiveTab('dating')} className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'dating' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
          <Heart size={16} className={activeTab === 'dating' ? 'text-red-400 fill-red-400' : ''} /> Social
        </button>
        <button onClick={() => setActiveTab('hiring')} className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'hiring' ? 'bg-orange-500 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
          <Hammer size={16} className={activeTab === 'hiring' ? 'fill-orange-200' : ''} /> Hire
        </button>
      </div>

      {/* --- SOCIAL TAB (GT2 LOGIC) --- */}
      {activeTab === 'dating' && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
             {/* Filters Bar (GT2 Style) */}
            <div className={`bg-white p-3 rounded-2xl shadow-sm mb-4 border border-slate-100`}>
                <div className="grid grid-cols-2 gap-3 items-end">
                    <div className="col-span-2 flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                        <label className="flex items-center text-xs font-bold text-slate-700 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                name="verified"
                                checked={socialFilter.verified}
                                onChange={handleFilterChange}
                                className={`mr-2 h-4 w-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500`}
                            />
                            Verified Only
                        </label>
                        {/* GPS STATUS & MANUAL BUTTON */}
                        {userProfile?.latitude ? (
                            <span className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                                <Navigation size={10} /> GPS Active
                            </span>
                        ) : (
                            <button onClick={onEnableLocation} className="text-[10px] bg-slate-900 text-white px-2 py-1 rounded-full flex items-center gap-1 font-bold animate-pulse">
                                <Navigation size={10} /> Enable Location
                            </button>
                        )}
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Trade</label>
                        <select
                            name="trade"
                            value={socialFilter.trade}
                            onChange={handleFilterChange}
                            className={`w-full p-2 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:border-orange-500`}
                        >
                            <option value="">Any</option>
                            {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Max Dist ({socialFilter.distance} km)</label>
                        <input
                            type="range"
                            name="distance"
                            min="10"
                            max="200"
                            step="10"
                            value={socialFilter.distance}
                            onChange={handleFilterChange}
                            className={`w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-600`}
                        />
                    </div>
                </div>
            </div>

            {/* Profile Grid (GT2 Style) */}
            <div className="grid grid-cols-3 gap-3">
                {filteredSocialProfiles.length > 0 ? (
                    filteredSocialProfiles.map(profile => (
                        <ProfileTile
                            key={profile.uid}
                            profile={profile}
                            distanceKm={profile.distanceKm}
                            onOpenProfile={setSelectedSocialProfile}
                            isCurrentUser={profile.uid === user.uid}
                            shouldBlur={profile.blurPhotos && profile.uid !== user.uid}
                            hideDistance={profile.hideDistance}
                        />
                    ))
                ) : (
                    <div className={`col-span-full py-12 text-center`}>
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <Filter className="text-slate-300" />
                        </div>
                        <p className={`text-slate-600 font-bold`}>No matches found.</p>
                        <p className="text-xs text-slate-400">Try adjusting your filters.</p>
                    </div>
                )}
            </div>

            {/* Profile Modal (GT2 Style) */}
            {selectedSocialProfile && (
                <ProfileModal
                    profile={selectedSocialProfile}
                    distanceKm={selectedSocialProfile.distanceKm}
                    onClose={() => setSelectedSocialProfile(null)}
                    onConnect={handleConnect}
                    onMessage={(p) => { setSelectedSocialProfile(null); onMessage(p); }}
                    hideDistance={selectedSocialProfile.hideDistance}
                />
            )}
        </div>
      )}

      {/* --- HIRING TAB (GT1 LOGIC + UI TWEAKS) --- */}
      {activeTab === 'hiring' && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
           <div className="mb-4 flex gap-2">
               <div className="relative flex-1">
                   <MapPin className="absolute left-3 top-2.5 text-slate-400" size={16} />
                   <input 
                      type="text" 
                      placeholder="Filter by City/Area..." 
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-orange-500 shadow-sm"
                      value={manualLocation}
                      onChange={(e) => setManualLocation(e.target.value)}
                   />
               </div>
               {filter && (
                    <button onClick={clearFilter} className="bg-orange-100 px-3 py-2 rounded-xl text-orange-900 text-xs font-bold border border-orange-200 flex items-center gap-1 shadow-sm">
                         <X size={14}/> {filter}
                    </button>
               )}
          </div>

          <div className="space-y-4">
             {filteredHiringProfiles.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                    <User size={48} className="mx-auto mb-3 opacity-20" />
                    <p className="font-bold">No pros found.</p>
                </div>
             ) : (
                filteredHiringProfiles.map(p => {
                    const shouldUnblur = acceptedTradieIds.has(p.uid);
                    return (
                        <TradieCard 
                            key={p.uid} 
                            profile={p} 
                            mode={activeTab} 
                            isTrusted={shouldUnblur}
                            onMessage={() => onMessage(p)} 
                            onRequestJob={() => onRequestJob(p)}
                        />
                    );
                })
             )}
          </div>
        </div>
      )}
    </div>
  );
};

// Kept from GT1 for Hiring View
const TradieCard = ({ profile, mode, isTrusted, onMessage, onRequestJob }) => (
  <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100 mb-4 group hover:shadow-md transition-shadow">
    {/* Cover Photo */}
    <div className="h-28 w-full bg-slate-200 relative overflow-hidden">
        {profile.coverPhoto ? (
            <img src={profile.coverPhoto} alt="Cover" className="w-full h-full object-cover" />
        ) : (
            <div className="w-full h-full bg-gradient-to-r from-slate-200 to-slate-300 flex items-center justify-center opacity-50">
                 <Hammer className="text-slate-400 opacity-20 transform -rotate-12" size={64} />
            </div>
        )}
        <div className="absolute top-2 right-2">
            {profile.verified && <Badge type="verified" text="Verified" />}
        </div>
    </div>

    <div className="px-4 pb-4 relative">
        {/* Profile Picture Inset */}
        <div className="-mt-10 mb-3 flex justify-between items-end">
             <div className={`relative p-1 bg-white rounded-full ${profile.role === 'tradie' ? 'shadow-lg' : ''}`}>
                 <Avatar 
                    profile={profile} 
                    size="xl" 
                    className="w-20 h-20" 
                    blur={mode === 'hiring' && !isTrusted} 
                 />
                 {mode === 'hiring' && !isTrusted && (
                     <div className="absolute inset-0 flex items-center justify-center">
                          <div className="bg-black/50 p-1 rounded-full text-white backdrop-blur-sm" title="Hire to unblur">
                              <ShieldCheck size={16} />
                          </div>
                     </div>
                 )}
             </div>
             
             <div className="flex gap-2 mb-1">
                 <Button variant="secondary" className="py-2 px-4 text-xs h-9 shadow-sm" onClick={onRequestJob}>
                    Request Job
                 </Button>
             </div>
        </div>
        
        {/* Content */}
        <div>
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-lg font-bold flex items-center gap-1 text-slate-900">
                        {profile.name || profile.username}, {profile.age}
                    </h3>
                    <div className="flex items-center text-xs text-slate-500 gap-1 mb-1">
                        <MapPin size={10} /> 
                        {profile.location}
                        {profile.distanceKm !== undefined && profile.distanceKm < 9999 && (
                            <span className="text-slate-400">• {profile.distanceKm < 1 ? '<1km' : `${Math.round(profile.distanceKm)}km`} away</span>
                        )}
                    </div>
                </div>
                {profile.rate && (
                     <div className="text-right">
                         <span className="block font-mono font-bold text-slate-800">£{profile.rate}/hr</span>
                         <div className="flex items-center justify-end gap-0.5 text-xs text-orange-500">
                             <Star size={10} fill="currentColor"/> 
                             <span className="font-bold">{profile.rating?.toFixed(1) || '5.0'}</span>
                             <span className="text-slate-400 ml-1">({profile.reviews || 0})</span>
                         </div>
                     </div>
                )}
            </div>

            {profile.trade && (
                 <div className="mb-2 mt-1">
                    <Badge type="trade" text={profile.trade} />
                 </div>
            )}
            
            <p className="text-slate-600 text-sm line-clamp-2 mt-2">{profile.bio}</p>
        </div>
    </div>
  </div>
);

// --- Shop, Job Board, Chat, Profile (Mostly GT1 Structure) ---

const Shop = ({ user, showToast, onCartChange }) => {
    const [cart, setCart] = useState([]);
    const [showCart, setShowCart] = useState(false);
    
    const products = [
        { id: 1, name: 'GayTradies™ Tee', price: 25, image: '👕' },
        { id: 2, name: 'Pro Tool Belt', price: 45, image: '🛠️' },
        { id: 3, name: 'Hard Hat (Safety)', price: 15, image: '👷' },
        { id: 4, name: 'Rainbow Mug', price: 12, image: '☕' },
        { id: 5, name: 'Trucker Cap', price: 18, image: '🧢' },
        { id: 6, name: 'Premium Hoodie', price: 50, image: '🧥' },
    ];

    const addToCart = (product) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                return prev.map(item => 
                    item.id === product.id 
                        ? {...item, quantity: item.quantity + 1}
                        : item
                );
            }
            return [...prev, {...product, quantity: 1}];
        });
        showToast(`Added ${product.name} to cart!`, 'success');
    };

    const removeFromCart = (productId) => {
        setCart(prev => prev.filter(item => item.id !== productId));
    };

    const updateQuantity = (productId, change) => {
        setCart(prev => prev.map(item => {
            if (item.id === productId) {
                const newQty = item.quantity + change;
                return newQty > 0 ? {...item, quantity: newQty} : item;
            }
            return item;
        }).filter(item => item.quantity > 0));
    };

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

    // Notify parent about cart changes
    useEffect(() => {
        if (onCartChange) {
            onCartChange(cartCount);
        }
    }, [cartCount, onCartChange]);

    const handleCheckout = async () => {
        if (!user || !db) {
            showToast("Please sign in to checkout", "error");
            return;
        }
        
        try {
            // Create order in database
            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'orders'), {
                userId: user.uid,
                items: cart,
                total: cartTotal,
                status: 'pending',
                createdAt: serverTimestamp()
            });
            
            showToast("Order placed! Check email for details.", "success");
            setCart([]);
            setShowCart(false);
        } catch (error) {
            console.error("Checkout error:", error);
            showToast("Failed to place order. Please try again.", "error");
        }
    };

    return (
        <div className="p-4">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
                    <ShoppingBag className="text-orange-500"/> Shop
                </h2>
                <button 
                    onClick={() => setShowCart(true)}
                    className="relative p-2 bg-orange-500 text-white rounded-full shadow-lg hover:bg-orange-600 transition-colors"
                >
                    <ShoppingCart size={20} />
                    {cartCount > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                            {cartCount}
                        </span>
                    )}
                </button>
            </div>
            
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                <ShoppingCart className="text-orange-600 shrink-0 mt-0.5" size={20} />
                <p className="text-xs text-orange-900 leading-relaxed font-medium">Official merchandise and tools. All proceeds support the platform and LGBT trade charities.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                {products.map(p => (
                    <div key={p.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col group hover:shadow-md transition-shadow">
                        <div className="h-32 bg-slate-50 flex items-center justify-center text-5xl group-hover:scale-105 transition-transform">
                            {p.image}
                        </div>
                        <div className="p-3 flex-1 flex flex-col">
                            <h3 className="font-bold text-sm mb-1 text-slate-800">{p.name}</h3>
                            <p className="text-slate-500 text-xs mb-3 font-mono">£{p.price}.00</p>
                            <div className="mt-auto">
                                <Button 
                                    variant="secondary" 
                                    className="w-full py-2 text-xs h-8" 
                                    onClick={() => addToCart(p)}
                                >
                                    Add to Cart
                                </Button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Cart Modal */}
            {showCart && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-end sm:items-center justify-center">
                    <div className="bg-white w-full sm:w-[400px] h-[80vh] sm:h-auto sm:max-h-[80vh] sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl relative flex flex-col">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-900 text-white">
                            <h3 className="text-lg font-bold">Shopping Cart</h3>
                            <button onClick={() => setShowCart(false)}>
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-4">
                            {cart.length === 0 ? (
                                <div className="text-center py-10 text-slate-400">
                                    <ShoppingCart size={48} className="mx-auto mb-2 opacity-50" />
                                    <p>Your cart is empty</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {cart.map(item => (
                                        <div key={item.id} className="bg-slate-50 rounded-lg p-3 flex items-center gap-3">
                                            <div className="text-3xl">{item.image}</div>
                                            <div className="flex-1">
                                                <h4 className="font-bold text-sm">{item.name}</h4>
                                                <p className="text-xs text-slate-500">£{item.price}.00</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={() => updateQuantity(item.id, -1)}
                                                    className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 flex items-center justify-center font-bold"
                                                >
                                                    -
                                                </button>
                                                <span className="w-8 text-center font-bold">{item.quantity}</span>
                                                <button 
                                                    onClick={() => updateQuantity(item.id, 1)}
                                                    className="w-6 h-6 rounded bg-slate-200 hover:bg-slate-300 flex items-center justify-center font-bold"
                                                >
                                                    +
                                                </button>
                                            </div>
                                            <button 
                                                onClick={() => removeFromCart(item.id)}
                                                className="text-red-500 hover:text-red-700"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        {cart.length > 0 && (
                            <div className="p-4 border-t border-slate-200 bg-white">
                                <div className="flex justify-between items-center mb-4">
                                    <span className="font-bold text-lg">Total:</span>
                                    <span className="font-bold text-2xl text-orange-600">£{cartTotal}.00</span>
                                </div>
                                <Button onClick={handleCheckout} variant="secondary" className="w-full py-3">
                                    Checkout
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const PostJobAdvert = ({ user, onCancel, onSuccess }) => {
  const [jobData, setJobData] = useState({ title: '', description: '', budget: '', tradeCategory: 'Electrician', location: '' });

  const submitAdvert = async () => {
    if(!jobData.title) return;
    await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'job_adverts'), {
       ...jobData,
       clientUid: user.uid,
       clientName: user.displayName || 'Client', 
       createdAt: serverTimestamp()
    });
    onSuccess();
  };

  return (
    <div className="p-4 min-h-screen bg-white z-[60] absolute inset-0">
       <button onClick={onCancel} className="mb-4 text-slate-500 flex items-center gap-1 font-bold"><ArrowRight className="rotate-180" size={16}/> Back</button>
       <h2 className="text-2xl font-bold mb-2">Post a Job Advert</h2>
       <p className="text-slate-500 mb-6 text-sm">Visible to verified tradies matching the category.</p>
       
       <Input label="Job Title" placeholder="e.g. Rewire Kitchen" value={jobData.title} onChange={e => setJobData({...jobData, title: e.target.value})} />
       
       <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Required Trade</label>
          <select className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500" value={jobData.tradeCategory} onChange={e => setJobData({...jobData, tradeCategory: e.target.value})}>
             {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
       </div>

       <Input label="Location (City/Area)" placeholder="e.g. Hackney, London" value={jobData.location} onChange={e => setJobData({...jobData, location: e.target.value})} />
       <Input label="Description" textarea rows={4} placeholder="Describe the work needed..." value={jobData.description} onChange={e => setJobData({...jobData, description: e.target.value})} />
       <Input label="Estimated Budget" placeholder="e.g. £300" value={jobData.budget} onChange={e => setJobData({...jobData, budget: e.target.value})} />
       
       <Button onClick={submitAdvert} variant="secondary" className="w-full mt-4">Post Advert</Button>
    </div>
  );
};

const JobRequestForm = ({ user, tradie, onCancel, onSuccess }) => {
  const [jobData, setJobData] = useState({ title: '', description: '', budget: '' });

  const submitJob = async () => {
    if(!jobData.title) return;
    
    // Check email verification - reload user first to get latest status
    if (user) {
      try {
        await user.reload();
        const updatedUser = auth.currentUser;
        
        if (updatedUser && !updatedUser.emailVerified) {
          alert('Please verify your email before requesting jobs. Check your inbox for the verification link.');
          return;
        }
      } catch (err) {
        console.error('Error checking verification:', err);
        // If reload fails, fall back to cached status
        if (!user.emailVerified) {
          alert('Please verify your email before requesting jobs. Check your inbox for the verification link.');
          return;
        }
      }
    }
    
    await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'jobs'), {
       ...jobData,
       clientUid: user.uid,
       tradieUid: tradie.uid,
       tradieName: tradie.name || tradie.username,
       clientName: user.displayName || 'Client', 
       status: 'Pending',
       createdAt: serverTimestamp()
    });
    onSuccess();
  };

  return (
    <div className="p-4 min-h-screen bg-white z-[60] absolute inset-0">
       <button onClick={onCancel} className="mb-4 text-slate-500 flex items-center gap-1 font-bold"><ArrowRight className="rotate-180" size={16}/> Back</button>
       <h2 className="text-2xl font-bold mb-2">Hire {tradie.name || tradie.username}</h2>
       <p className="text-slate-500 mb-6 text-sm">Send a direct request for work.</p>
       
       <Input label="Job Title" placeholder="e.g. Fix leaky tap" value={jobData.title} onChange={e => setJobData({...jobData, title: e.target.value})} />
       <Input label="Description" textarea rows={4} placeholder="Describe the work needed..." value={jobData.description} onChange={e => setJobData({...jobData, description: e.target.value})} />
       <Input label="Estimated Budget" placeholder="e.g. £100" value={jobData.budget} onChange={e => setJobData({...jobData, budget: e.target.value})} />
       
       <Button onClick={submitJob} variant="secondary" className="w-full mt-4">Send Request</Button>
    </div>
  );
};

const JobManager = ({ user, userProfile, onPendingCountChange }) => {
    const [viewMode, setViewMode] = useState('active'); 
    const [jobs, setJobs] = useState([]); 
    const [adverts, setAdverts] = useState([]);
    const [hiddenJobs, setHiddenJobs] = useState([]);
    const [showBlockConfirm, setShowBlockConfirm] = useState(false);
    const [userToBlock, setUserToBlock] = useState(null);
    const [showReviewModal, setShowReviewModal] = useState(false);
    const [jobToReview, setJobToReview] = useState(null);
    const [reviewData, setReviewData] = useState({ rating: 5, comment: '' });
    const [showInfoRequestModal, setShowInfoRequestModal] = useState(false);
    const [jobForInfoRequest, setJobForInfoRequest] = useState(null);
    const [infoPhotos, setInfoPhotos] = useState([]);
    const [infoDescription, setInfoDescription] = useState('');
    const [showQuoteModal, setShowQuoteModal] = useState(false);
    const [jobForQuote, setJobForQuote] = useState(null);
    const [quoteData, setQuoteData] = useState({ hourlyRate: '', estimatedHours: '', notes: '' });
    const [showDeclineModal, setShowDeclineModal] = useState(false);
    const [jobToDecline, setJobToDecline] = useState(null);
    const [declineReason, setDeclineReason] = useState('');
    const [showBookingModal, setShowBookingModal] = useState(false);
    const [jobForBooking, setJobForBooking] = useState(null);
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedTimeSlot, setSelectedTimeSlot] = useState('');
    const [serviceAddress, setServiceAddress] = useState('');
    const [servicePhone, setServicePhone] = useState('');
    const [serviceEmail, setServiceEmail] = useState('');
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [jobForPayment, setJobForPayment] = useState(null);
    const [processingPayment, setProcessingPayment] = useState(false);
    const [showPhotoGallery, setShowPhotoGallery] = useState(false);
    const [galleryPhotos, setGalleryPhotos] = useState([]);
    const [showCalendarModal, setShowCalendarModal] = useState(false);
    const [tradieAvailability, setTradieAvailability] = useState([]);

    useEffect(() => {
        if(!user || !db) return;
        const q = collection(db, 'artifacts', getAppId(), 'public', 'data', 'jobs');
        const unsub = onSnapshot(q, (snapshot) => {
            const myJobs = snapshot.docs.map(d => ({id: d.id, ...d.data()}))
                .filter(job => job.clientUid === user.uid || job.tradieUid === user.uid)
                .sort((a, b) => {
                    // Sort by creation date, newest first
                    const aTime = a.createdAt?.toMillis?.() || 0;
                    const bTime = b.createdAt?.toMillis?.() || 0;
                    return bTime - aTime;
                });
            setJobs(myJobs);
            
            // Update jobs notification - check for pending actions
            const hasPendingActions = myJobs.some(job => {
                const isTradie = job.tradieUid === user.uid;
                const isClient = job.clientUid === user.uid;
                
                // Check for various pending states requiring action
                if (isTradie && job.status === 'Pending') return true; // New request
                if (isClient && job.status === 'InfoRequested') return true; // Info requested
                if (isClient && job.status === 'QuoteProvided') return true; // Quote to review
                if (isTradie && job.status === 'BookingRequested') return true; // Booking to confirm
                if (isClient && job.status === 'BookingConfirmed') return true; // Payment required
                if (isTradie && job.status === 'TradieAccepted') return false; // Waiting on client
                if (isClient && job.status === 'TradieAccepted') return true; // Client needs to approve
                
                // Review needed
                if (job.status === 'Completed' && job.awaitingReview) {
                    const hasReviewed = isTradie ? job.tradieReviewed : job.clientReviewed;
                    return !hasReviewed;
                }
                
                return false;
            });
            
            setHasJobsNotification(hasPendingActions);
        });
        return () => unsub();
    }, [user]);

    useEffect(() => {
        if (viewMode === 'board' && userProfile?.role === 'tradie' && userProfile?.verified && db && user) {
             // Load job adverts
             const advertsQuery = collection(db, 'artifacts', getAppId(), 'public', 'data', 'job_adverts');
             const advertsUnsub = onSnapshot(advertsQuery, (snapshot) => {
                 const ads = snapshot.docs.map(d => ({id: d.id, ...d.data()}))
                     .filter(ad => ad.tradeCategory === userProfile.trade);
                 setAdverts(ads);
             });
             
             // Load hidden jobs for this tradie
             const hiddenQuery = collection(db, 'artifacts', getAppId(), 'public', 'data', 'hidden_jobs');
             const hiddenUnsub = onSnapshot(hiddenQuery, (snapshot) => {
                 const hidden = snapshot.docs
                     .filter(d => d.data().tradieUid === user.uid)
                     .map(d => d.data().advertId);
                 setHiddenJobs(hidden);
             });
             
             return () => {
                 advertsUnsub();
                 hiddenUnsub();
             };
        }
    }, [viewMode, userProfile, user]);

    // Load tradie availability if user is a tradie
    useEffect(() => {
        if (userProfile?.role === 'tradie' && user && db) {
            const q = collection(db, 'artifacts', getAppId(), 'public', 'data', 'tradie_availability');
            const unsub = onSnapshot(q, (snapshot) => {
                const availability = snapshot.docs
                    .filter(d => d.data().tradieUid === user.uid)
                    .map(d => ({ id: d.id, ...d.data() }));
                setTradieAvailability(availability);
            });
            return () => unsub();
        }
    }, [userProfile, user]);

    // Update pending jobs count whenever jobs change
    useEffect(() => {
        if (onPendingCountChange && user) {
            const count = getPendingActionsCount();
            onPendingCountChange(count);
        }
    }, [jobs, user, userProfile]);

    const handleBlockFromJob = async () => {
        if (!userToBlock) return;
        try {
            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users'), {
                blockedBy: user.uid,
                blockedUser: userToBlock.uid,
                blockedUserName: userToBlock.name,
                blockedAt: serverTimestamp(),
                source: 'job'
            });
            setShowBlockConfirm(false);
            setUserToBlock(null);
        } catch (error) {
            console.error("Error blocking user:", error);
        }
    };

    const handleStatusUpdate = async (jobId, newStatus) => {
        try {
            const updateData = { status: newStatus };
            
            // If moving to Completed, set awaitingReview flags and delete ALL private information for privacy
            if (newStatus === 'Completed') {
                updateData.awaitingReview = true;
                updateData.completedAt = serverTimestamp();
                updateData.jobPhotos = []; // Delete photos for privacy
                // Delete ALL private contact information
                updateData['serviceLocation.address'] = '';
                updateData['serviceLocation.phone'] = '';
                updateData['serviceLocation.email'] = '';
                
                // Move payment from "On Hold" to "Available" for tradie
                const jobDoc = await getDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobId));
                if (jobDoc.exists()) {
                    const jobData = jobDoc.data();
                    if (jobData.tradieUid && jobData.tradieAmount) {
                        const tradieAmount = jobData.tradieAmount;
                        
                        // Update tradie's balance
                        await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', jobData.tradieUid), {
                            'finances.onHoldBalance': increment(-tradieAmount),
                            'finances.availableBalance': increment(tradieAmount)
                        });
                        
                        // Update transaction status
                        const q = query(
                            collection(db, 'artifacts', getAppId(), 'public', 'data', 'transactions'),
                            where('jobId', '==', jobId),
                            where('type', '==', 'payment')
                        );
                        const txSnapshot = await getDocs(q);
                        const updatePromises = txSnapshot.docs.map(txDoc => 
                            updateDoc(txDoc.ref, { status: 'completed' })
                        );
                        await Promise.all(updatePromises);
                    }
                }
            }
            
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobId), updateData);
            
            // Immediately show review modal for the user who just completed the job
            if (newStatus === 'Completed') {
                const jobDoc = await getDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobId));
                if (jobDoc.exists()) {
                    setJobToReview({ id: jobId, ...jobDoc.data() });
                    setShowReviewModal(true);
                }
            }
        } catch (error) {
            console.error("Error updating job status:", error);
        }
    };

    const handleSubmitReview = async () => {
        if (!jobToReview || !reviewData.rating) return;
        
        try {
            const job = jobToReview;
            const isTradie = job.tradieUid === user.uid;
            const reviewedUid = isTradie ? job.clientUid : job.tradieUid;
            const reviewedName = isTradie ? job.clientName : job.tradieName;
            const reviewerRole = isTradie ? 'tradie' : 'client';
            
            // Add review to collection
            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'job_reviews'), {
                jobId: job.id,
                reviewedUid,
                reviewedName,
                reviewerUid: user.uid,
                reviewerName: userProfile?.name || user.displayName || 'User',
                reviewerRole,
                rating: reviewData.rating,
                comment: reviewData.comment.trim(),
                createdAt: serverTimestamp()
            });
            
            // Update job to mark this user's review as complete
            const reviewField = isTradie ? 'tradieReviewed' : 'clientReviewed';
            const updateData = { [reviewField]: true };
            
            // Check if both have now reviewed - if so, archive the job (keep minimal record)
            const otherReviewField = isTradie ? 'clientReviewed' : 'tradieReviewed';
            const bothReviewed = job[otherReviewField]; // Other party already reviewed
            
            if (bothReviewed) {
                // Both parties have now reviewed - Archive job (keep minimal record for legal/dispute purposes)
                updateData.archived = true;
                updateData.awaitingReview = false;
                // Generate invoice ID if not exists
                if (!job.invoiceId) {
                    updateData.invoiceId = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
                }
                await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', job.id), updateData);
            } else {
                // Only this user has reviewed so far, update the job
                await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', job.id), updateData);
            }
            
            // Update tradie's average rating if reviewing a tradie
            if (reviewerRole === 'client') {
                await updateTradieRating(reviewedUid);
            }
            
            setShowReviewModal(false);
            setJobToReview(null);
            setReviewData({ rating: 5, comment: '' });
        } catch (error) {
            console.error("Error submitting review:", error);
        }
    };
    
    const updateTradieRating = async (tradieUid) => {
        try {
            // Get all reviews for this tradie
            const reviewsRef = collection(db, 'artifacts', getAppId(), 'public', 'data', 'job_reviews');
            const q = query(reviewsRef, where('reviewedUid', '==', tradieUid), where('reviewerRole', '==', 'client'));
            const snapshot = await getDocs(q);
            
            if (snapshot.empty) return;
            
            const reviews = snapshot.docs.map(doc => doc.data());
            const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
            const reviewCount = reviews.length;
            
            // Update tradie profile
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', tradieUid), {
                rating: avgRating,
                reviews: reviewCount
            });
        } catch (error) {
            console.error("Error updating tradie rating:", error);
        }
    };

    // Enhanced workflow handlers
    const handleRequestInfo = async (jobId) => {
        try {
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobId), {
                status: 'InfoRequested',
                infoRequestedAt: serverTimestamp()
            });
        } catch (error) {
            console.error("Error requesting info:", error);
        }
    };

    const handleSubmitInfo = async () => {
        if (!jobForInfoRequest || infoPhotos.length === 0) return;
        try {
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobForInfoRequest.id), {
                status: 'InfoProvided',
                infoPhotos: infoPhotos,
                infoDescription: infoDescription,
                infoProvidedAt: serverTimestamp()
            });
            setShowInfoRequestModal(false);
            setInfoPhotos([]);
            setInfoDescription('');
            setJobForInfoRequest(null);
        } catch (error) {
            console.error("Error submitting info:", error);
        }
    };

    const handleSubmitQuote = async () => {
        if (!jobForQuote || !quoteData.hourlyRate || !quoteData.estimatedHours) return;
        try {
            const total = parseFloat(quoteData.hourlyRate) * parseFloat(quoteData.estimatedHours);
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobForQuote.id), {
                status: 'QuoteProvided',
                quote: {
                    hourlyRate: parseFloat(quoteData.hourlyRate),
                    estimatedHours: parseFloat(quoteData.estimatedHours),
                    total: total,
                    notes: quoteData.notes
                },
                quotedAt: serverTimestamp()
            });
            setShowQuoteModal(false);
            setQuoteData({ hourlyRate: '', estimatedHours: '', notes: '' });
            setJobForQuote(null);
        } catch (error) {
            console.error("Error submitting quote:", error);
        }
    };

    const handleDeclineJob = async () => {
        if (!jobToDecline || !declineReason.trim()) return;
        try {
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobToDecline.id), {
                status: 'Declined',
                declineReason: declineReason,
                declinedAt: serverTimestamp()
            });
            setShowDeclineModal(false);
            setDeclineReason('');
            setJobToDecline(null);
        } catch (error) {
            console.error("Error declining job:", error);
        }
    };

    const handleAcceptQuote = async (jobId) => {
        try {
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobId), {
                status: 'QuoteAccepted',
                quoteAcceptedAt: serverTimestamp()
            });
        } catch (error) {
            console.error("Error accepting quote:", error);
        }
    };

    const handleDeclineQuote = async (jobId) => {
        try {
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobId), {
                status: 'QuoteDeclined',
                quoteDeclinedAt: serverTimestamp()
            });
        } catch (error) {
            console.error("Error declining quote:", error);
        }
    };

    const handleSubmitBooking = async () => {
        if (!jobForBooking || !selectedDate || !selectedTimeSlot || !serviceAddress.trim() || !servicePhone.trim()) {
            alert('Please fill in all required fields (address, phone, date, and time)');
            return;
        }
        try {
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobForBooking.id), {
                status: 'BookingRequested',
                booking: {
                    date: selectedDate,
                    timeSlot: selectedTimeSlot
                },
                serviceLocation: {
                    address: serviceAddress,
                    phone: servicePhone,
                    email: serviceEmail || user?.email || ''
                },
                bookingRequestedAt: serverTimestamp()
            });
            setShowBookingModal(false);
            setSelectedDate(null);
            setSelectedTimeSlot('');
            setServiceAddress('');
            setServicePhone('');
            setServiceEmail('');
            setJobForBooking(null);
        } catch (error) {
            console.error("Error submitting booking:", error);
        }
    };

    const handleConfirmBooking = async (jobId) => {
        try {
            const job = jobs.find(j => j.id === jobId);
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobId), {
                status: 'BookingConfirmed',
                bookingConfirmedAt: serverTimestamp()
            });
            
            // Update tradie's work calendar to mark the booked time as unavailable
            if (job?.tradieUid && job?.booking?.date && job?.booking?.timeSlot) {
                const tradieRef = doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', job.tradieUid);
                const tradieDoc = await getDoc(tradieRef);
                const tradieData = tradieDoc.data();
                const workCalendar = tradieData?.workCalendar || {};
                
                // Support both old format (array) and new format (object)
                const dateSlots = workCalendar[job.booking.date];
                let updatedDateSlots;
                
                if (Array.isArray(dateSlots)) {
                    // Old format - convert to new format
                    updatedDateSlots = {};
                    dateSlots.forEach(slot => {
                        updatedDateSlots[slot] = { reason: 'manual' };
                    });
                } else {
                    updatedDateSlots = dateSlots || {};
                }
                
                // Add the booked time slot
                updatedDateSlots[job.booking.timeSlot] = { 
                    reason: 'job', 
                    jobId: jobId 
                };
                
                await updateDoc(tradieRef, {
                    [`workCalendar.${job.booking.date}`]: updatedDateSlots
                });
            }
        } catch (error) {
            console.error("Error confirming booking:", error);
        }
    };

    const handleProcessPayment = async () => {
        if (!jobForPayment) return;
        setProcessingPayment(true);
        
        // Simulate payment processing
        setTimeout(async () => {
            try {
                const paymentAmount = jobForPayment.quote?.total || 0;
                const commission = paymentAmount * 0.15; // 15% commission
                const tradieAmount = paymentAmount - commission;
                
                // Update job status
                await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', jobForPayment.id), {
                    status: 'PaymentComplete',
                    paymentCompletedAt: serverTimestamp(),
                    paymentAmount: paymentAmount,
                    commission: commission,
                    tradieAmount: tradieAmount
                });
                
                // Add payment to tradie's "On Hold" balance
                if (jobForPayment.tradieUid) {
                    await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', jobForPayment.tradieUid), {
                        'finances.onHoldBalance': increment(tradieAmount),
                        'finances.totalEarnings': increment(tradieAmount),
                        'finances.totalCommissionPaid': increment(commission)
                    });
                    
                    // Create transaction record
                    await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'transactions'), {
                        tradieUid: jobForPayment.tradieUid,
                        jobId: jobForPayment.id,
                        jobTitle: jobForPayment.title || 'Job',
                        type: 'payment',
                        amount: tradieAmount,
                        commission: commission,
                        status: 'onHold',
                        createdAt: serverTimestamp()
                    });
                }
                
                setProcessingPayment(false);
                setShowPaymentModal(false);
                
                // Store jobId before clearing state
                const completedJobId = jobForPayment.id;
                setJobForPayment(null);
                
                // Automatically move to InProgress after payment
                setTimeout(async () => {
                    try {
                        await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'jobs', completedJobId), {
                            status: 'InProgress',
                            startedAt: serverTimestamp()
                        });
                    } catch (error) {
                        console.error("Error moving job to InProgress:", error);
                    }
                }, 1000);
            } catch (error) {
                console.error("Error processing payment:", error);
                setProcessingPayment(false);
            }
        }, 2000);
    };

    const handleAcceptJobFromBoard = async (advert) => {
        try {
            // Create a new job from the advert
            const jobRef = await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'jobs'), {
                title: advert.title,
                description: advert.description,
                budget: advert.budget,
                clientUid: advert.clientUid,
                clientName: advert.clientName,
                tradieUid: user.uid,
                tradieName: userProfile?.name || user.displayName || 'Tradie',
                tradieTrade: userProfile?.trade || 'Tradie',
                status: 'TradieAccepted', // Awaiting client approval
                source: 'job_board',
                createdAt: serverTimestamp(),
                acceptedAt: serverTimestamp()
            });
            
            // Delete the advert from job_adverts
            await deleteDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'job_adverts', advert.id));
            
            showToast('Job accepted! Awaiting client approval.');
        } catch (error) {
            console.error("Error accepting job from board:", error);
            showToast('Error accepting job');
        }
    };

    const handleHideJobFromBoard = async (advertId) => {
        try {
            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'hidden_jobs'), {
                tradieUid: user.uid,
                advertId: advertId,
                hiddenAt: serverTimestamp()
            });
            showToast('Job hidden from your view');
        } catch (error) {
            console.error("Error hiding job:", error);
        }
    };

    const handleImageUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length + infoPhotos.length > 5) {
            alert('Maximum 5 photos allowed');
            return;
        }

        const readers = files.map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(file);
            });
        });

        const results = await Promise.all(readers);
        setInfoPhotos([...infoPhotos, ...results]);
    };

    const getStatusColor = (status) => {
        switch(status) {
            case 'Pending': return 'bg-yellow-100 text-yellow-700';
            case 'TradieAccepted': return 'bg-cyan-100 text-cyan-700';
            case 'InfoRequested': return 'bg-blue-100 text-blue-700';
            case 'InfoProvided': return 'bg-cyan-100 text-cyan-700';
            case 'QuoteProvided': return 'bg-indigo-100 text-indigo-700';
            case 'QuoteAccepted': return 'bg-purple-100 text-purple-700';
            case 'BookingRequested': return 'bg-violet-100 text-violet-700';
            case 'BookingConfirmed': return 'bg-fuchsia-100 text-fuchsia-700';
            case 'PaymentComplete': return 'bg-green-100 text-green-700';
            case 'Accepted': return 'bg-blue-100 text-blue-700';
            case 'InProgress': return 'bg-purple-100 text-purple-700';
            case 'Completed': return 'bg-green-100 text-green-700';
            case 'Declined': return 'bg-red-100 text-red-700';
            case 'QuoteDeclined': return 'bg-red-100 text-red-700';
            default: return 'bg-slate-100 text-slate-600';
        }
    };

    // Get contextual status message for job
    const getJobStatusMessage = (job, isTradie) => {
        const tradeName = job.tradeName || job.tradieTrade || 'Tradie';
        const clientName = job.clientName || 'Client';
        const quoteAmount = job.quote?.total?.toFixed(2) || '0';
        const paymentAmount = job.paymentAmount?.toFixed(2) || quoteAmount;
        const bookingDate = job.booking?.date || '';
        const bookingTime = job.booking?.timeSlot || '';
        
        if (job.status === 'Declined') {
            return { text: `This job was declined. ${job.declineReason ? `Reason: ${job.declineReason}` : ''}`, color: 'bg-red-50 border-red-200 text-red-700' };
        }
        if (job.status === 'QuoteDeclined') {
            return isTradie 
                ? { text: `${clientName} declined your quote.`, color: 'bg-red-50 border-red-200 text-red-700' }
                : { text: `You declined the quote from ${tradeName}.`, color: 'bg-gray-50 border-gray-200 text-gray-700' };
        }
        
        switch(job.status) {
            case 'TradieAccepted':
                return isTradie
                    ? { text: `You accepted this job from the Job Board. Awaiting ${clientName}'s approval.`, color: 'bg-blue-50 border-blue-200 text-blue-700' }
                    : { text: `${tradeName} has accepted your job posting. Review and approve to continue.`, color: 'bg-orange-50 border-orange-200 text-orange-700' };
            
            case 'Pending':
                return isTradie 
                    ? { text: `New job request from ${clientName}. Review and respond.`, color: 'bg-orange-50 border-orange-200 text-orange-700' }
                    : { text: `Your request is being reviewed by the ${tradeName}.`, color: 'bg-blue-50 border-blue-200 text-blue-700' };
            
            case 'Accepted':
                return isTradie
                    ? { text: `Job accepted. Request more info or provide a quote to ${clientName}.`, color: 'bg-blue-50 border-blue-200 text-blue-700' }
                    : { text: `The ${tradeName} has accepted your job request.`, color: 'bg-green-50 border-green-200 text-green-700' };
            
            case 'InfoRequested':
                return isTradie
                    ? { text: `Awaiting additional information from ${clientName}.`, color: 'bg-blue-50 border-blue-200 text-blue-700' }
                    : { text: `The ${tradeName} has accepted your job and requested more information from you.`, color: 'bg-orange-50 border-orange-200 text-orange-700' };
            
            case 'InfoProvided':
                return isTradie
                    ? { text: `${clientName} has provided the requested information. Review to provide a quote.`, color: 'bg-orange-50 border-orange-200 text-orange-700' }
                    : { text: `Information submitted. Awaiting quote from the ${tradeName}.`, color: 'bg-blue-50 border-blue-200 text-blue-700' };
            
            case 'QuoteProvided':
                return isTradie
                    ? { text: `${clientName} is reviewing your quote of £${quoteAmount}.`, color: 'bg-blue-50 border-blue-200 text-blue-700' }
                    : { text: `The ${tradeName} has provided a quote of £${quoteAmount}. Review and accept to continue.`, color: 'bg-orange-50 border-orange-200 text-orange-700' };
            
            case 'QuoteAccepted':
                return isTradie
                    ? { text: `${clientName} has accepted your quote of £${quoteAmount}. Awaiting booking selection.`, color: 'bg-green-50 border-green-200 text-green-700' }
                    : { text: `You've accepted the quote of £${quoteAmount}. Select a booking time to proceed.`, color: 'bg-orange-50 border-orange-200 text-orange-700' };
            
            case 'BookingRequested':
                return isTradie
                    ? { text: `New booking request for ${bookingDate} at ${bookingTime}. Confirm to proceed.`, color: 'bg-orange-50 border-orange-200 text-orange-700' }
                    : { text: `Booking request sent for ${bookingDate} at ${bookingTime}. Awaiting confirmation from the ${tradeName}.`, color: 'bg-blue-50 border-blue-200 text-blue-700' };
            
            case 'BookingConfirmed':
                return isTradie
                    ? { text: `Booking confirmed for ${bookingDate} at ${bookingTime}. Awaiting payment from ${clientName}.`, color: 'bg-blue-50 border-blue-200 text-blue-700' }
                    : { text: `The ${tradeName} has confirmed your booking. Complete payment to begin work.`, color: 'bg-orange-50 border-orange-200 text-orange-700' };
            
            case 'PaymentComplete':
                return { text: `Payment of £${paymentAmount} received. Work is now in progress.`, color: 'bg-green-50 border-green-200 text-green-700' };
            
            case 'InProgress':
                return isTradie
                    ? { text: `Payment of £${paymentAmount} received. You can begin work.`, color: 'bg-green-50 border-green-200 text-green-700' }
                    : { text: `Payment of £${paymentAmount} received. Work is now in progress.`, color: 'bg-blue-50 border-blue-200 text-blue-700' };
            
            case 'Completed':
                if (job.awaitingReview) {
                    const hasReviewed = isTradie ? job.tradieReviewed : job.clientReviewed;
                    if (hasReviewed) {
                        return { text: 'Job completed. Review submitted.', color: 'bg-green-50 border-green-200 text-green-700' };
                    }
                    return { text: 'Job completed! Leave a review to help others.', color: 'bg-orange-50 border-orange-200 text-orange-700' };
                }
                return { text: 'Job completed successfully.', color: 'bg-green-50 border-green-200 text-green-700' };
            
            default:
                return { text: '', color: '' };
        }
    };

    // Get progress steps for job
    const getJobProgress = (job) => {
        const steps = [
            { label: 'Request Made', key: 'request' },
            { label: 'Request Accepted', key: 'accepted' },
            { label: 'More Information', key: 'info' },
            { label: 'Quote Provided', key: 'quote' },
            { label: 'Quote Accepted', key: 'quoteAccepted' },
            { label: 'Booking Confirmed', key: 'booking' },
            { label: 'Payment Received', key: 'payment' },
            { label: 'Work Complete', key: 'complete' }
        ];

        const status = job.status;
        const infoSkipped = status !== 'Declined' && status !== 'Pending' && 
                          status !== 'Accepted' && status !== 'InfoRequested' && 
                          status !== 'InfoProvided' && job.status !== 'QuoteDeclined';

        return steps.map(step => {
            switch(step.key) {
                case 'request':
                    return { ...step, status: 'complete' };
                case 'accepted':
                    return { ...step, status: ['Pending', 'Declined'].includes(status) ? 'pending' : 'complete' };
                case 'info':
                    if (status === 'InfoRequested' || status === 'InfoProvided') return { ...step, status: 'complete' };
                    if (infoSkipped) return { ...step, status: 'skipped' };
                    return { ...step, status: 'pending' };
                case 'quote':
                    return { ...step, status: ['QuoteProvided', 'QuoteAccepted', 'BookingRequested', 'BookingConfirmed', 'PaymentComplete', 'InProgress', 'Completed'].includes(status) ? 'complete' : 'pending' };
                case 'quoteAccepted':
                    return { ...step, status: ['QuoteAccepted', 'BookingRequested', 'BookingConfirmed', 'PaymentComplete', 'InProgress', 'Completed'].includes(status) ? 'complete' : status === 'QuoteDeclined' ? 'skipped' : 'pending' };
                case 'booking':
                    return { ...step, status: ['BookingConfirmed', 'PaymentComplete', 'InProgress', 'Completed'].includes(status) ? 'complete' : 'pending' };
                case 'payment':
                    return { ...step, status: ['PaymentComplete', 'InProgress', 'Completed'].includes(status) ? 'complete' : 'pending' };
                case 'complete':
                    return { ...step, status: status === 'Completed' ? 'complete' : 'pending' };
                default:
                    return { ...step, status: 'pending' };
            }
        });
    };

    const getPendingActionsCount = () => {
        const isTradie = userProfile?.role === 'tradie';
        return jobs.filter(job => {
            if (isTradie) {
                // Tradie pending actions
                if (job.tradieUid === user.uid) {
                    if (job.status === 'Pending') return true;
                    if (job.status === 'InfoProvided') return true;
                    if (job.status === 'BookingRequested') return true;
                    if (job.status === 'Completed' && job.awaitingReview && !job.tradieReviewed) return true;
                }
            } else {
                // Client pending actions
                if (job.clientUid === user.uid) {
                    if (job.status === 'InfoRequested') return true;
                    if (job.status === 'QuoteProvided') return true;
                    if (job.status === 'BookingConfirmed') return true;
                    if (job.status === 'Completed' && job.awaitingReview && !job.clientReviewed) return true;
                }
            }
            return false;
        }).length;
    };

    return (
        <div className="p-4">
            {userProfile?.role === 'tradie' ? (
                <div className="flex bg-slate-200 p-1 rounded-xl mb-6">
                    <button onClick={() => setViewMode('active')} className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${viewMode === 'active' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}>My Active Jobs</button>
                    <button onClick={() => setViewMode('board')} className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${viewMode === 'board' ? 'bg-orange-500 shadow text-white' : 'text-slate-500'}`}>Job Board (New Leads)</button>
                </div>
            ) : (
                <h2 className="text-xl font-bold mb-4">My Requests & Adverts</h2>
            )}

            {viewMode === 'board' && userProfile?.role === 'tradie' && (
                <div>
                     {!userProfile.verified ? (
                         <div className="bg-slate-100 border border-slate-200 p-6 rounded-xl text-center">
                             <ShieldCheck className="mx-auto text-slate-400 mb-2" size={32} />
                             <h3 className="font-bold text-slate-800">Verification Required</h3>
                             <p className="text-sm text-slate-500 mb-4">To see the Job Board, you must verify your trade ID.</p>
                             <div className="inline-flex items-center gap-1 bg-white px-3 py-1 rounded border border-slate-200 text-xs font-mono text-slate-500"><Badge type="locked" text="Locked" /></div>
                         </div>
                     ) : (
                         <div className="space-y-3">
                             {adverts.length === 0 ? (
                                 <div className="text-center py-8 text-slate-400"><ClipboardList className="mx-auto mb-2 opacity-50" size={32}/><p>No open adverts for {userProfile.trade}s right now.</p></div>
                             ) : (
                                 adverts
                                     .filter(ad => !hiddenJobs.includes(ad.id)) // Filter out hidden jobs
                                     .map(ad => (
                                     <div key={ad.id} className="bg-white p-4 rounded-xl border border-orange-100 shadow-sm relative overflow-hidden">
                                         <div className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] px-2 py-1 rounded-bl font-bold">New Lead</div>
                                         <h4 className="font-bold text-slate-800">{ad.title}</h4>
                                         <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                                             <span className="flex items-center gap-1"><MapPin size={10} /> {ad.location}</span>
                                             <span className="font-mono bg-slate-100 px-1 rounded">Budget: {ad.budget}</span>
                                         </div>
                                         <p className="text-sm text-slate-600 mb-3">{ad.description}</p>
                                         <div className="flex gap-2">
                                             <Button variant="primary" className="flex-1 py-2 text-xs" onClick={() => handleAcceptJobFromBoard(ad)}>
                                                 Accept Job
                                             </Button>
                                             <Button variant="ghost" className="flex-1 py-2 text-xs border-slate-200" onClick={() => handleHideJobFromBoard(ad.id)}>
                                                 Hide Job
                                             </Button>
                                         </div>
                                     </div>
                                 ))
                             )}
                         </div>
                     )}
                </div>
            )}

            {viewMode === 'active' && (
                <div className="space-y-3">
                    {jobs.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 bg-white rounded-xl border border-slate-100"><Briefcase size={40} className="mx-auto mb-2 opacity-50"/><p>No active jobs.</p></div>
                    ) : (
                        jobs.map(job => {
                            const isTradie = job.tradieUid === user.uid;
                            const isClient = job.clientUid === user.uid;
                            const hasReviewed = isTradie ? job.tradieReviewed : job.clientReviewed;
                            const needsReview = job.status === 'Completed' && job.awaitingReview && !hasReviewed;
                            const statusMessage = getJobStatusMessage(job, isTradie);
                            const progressSteps = getJobProgress(job);
                            
                            // Archived job - minimal display with invoice and report option
                            if (job.archived) {
                                return (
                                    <div key={job.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1">
                                                <h4 className="font-bold text-slate-700">{job.title}</h4>
                                                <p className="text-xs text-slate-500 mt-1">Invoice: {job.invoiceId}</p>
                                            </div>
                                            <span className="text-xs font-medium px-2 py-1 rounded bg-green-100 text-green-700">
                                                ✓ Reviewed
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-600 mb-3">
                                            {isTradie ? `Client: ${job.clientName}` : `Tradie: ${job.tradieName}`}
                                        </p>
                                        <button
                                            onClick={() => {
                                                // TODO: Implement report/dispute modal
                                                alert('Report/dispute functionality coming soon. Invoice: ' + job.invoiceId);
                                            }}
                                            className="text-xs text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
                                        >
                                            <Flag size={12} />
                                            Report something
                                        </button>
                                    </div>
                                );
                            }
                            
                            return (
                                <div key={job.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                                    {/* Status Message Banner */}
                                    {statusMessage.text && (
                                        <div className={`mb-3 p-2 rounded border text-xs font-medium ${statusMessage.color}`}>
                                            {statusMessage.text}
                                        </div>
                                    )}
                                    
                                    <div className="flex gap-3">
                                        {/* Main Job Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-2">
                                                <h4 className="font-bold text-slate-800 flex-1">{job.title}</h4>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded capitalize ${getStatusColor(job.status)}`}>
                                                        {job.status}
                                                    </span>
                                                    {/* Block button only shown when job is Pending (before acceptance) */}
                                                    {job.status === 'Pending' && (
                                                        <button
                                                            onClick={() => {
                                                                setUserToBlock({
                                                                    uid: isTradie ? job.clientUid : job.tradieUid,
                                                                    name: isTradie ? job.clientName : job.tradieName
                                                                });
                                                                setShowBlockConfirm(true);
                                                            }}
                                                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                                                            title="Block user"
                                                        >
                                                            <Ban size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-xs text-slate-500 mb-2">
                                                {isTradie ? `Client: ${job.clientName}` : `Tradie: ${job.tradieName}`}
                                            </p>
                                            <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded mb-2">{job.description}</p>
                                            {job.budget && <p className="text-xs text-slate-500 mb-2">Budget: {job.budget}</p>}
                                    
                                    {/* Show photos if available */}
                                    {job.infoPhotos && job.infoPhotos.length > 0 && (
                                        <div className="mb-2">
                                            <p className="text-xs font-bold text-slate-600 mb-1">Photos:</p>
                                            <div className="flex gap-1 flex-wrap">
                                                {job.infoPhotos.slice(0, 3).map((photo, idx) => (
                                                    <img key={idx} src={photo} className="w-16 h-16 object-cover rounded border cursor-pointer" 
                                                        onClick={() => { setGalleryPhotos(job.infoPhotos); setShowPhotoGallery(true); }} />
                                                ))}
                                                {job.infoPhotos.length > 3 && (
                                                    <div className="w-16 h-16 bg-slate-100 rounded border flex items-center justify-center text-xs font-bold text-slate-500 cursor-pointer"
                                                        onClick={() => { setGalleryPhotos(job.infoPhotos); setShowPhotoGallery(true); }}>
                                                        +{job.infoPhotos.length - 3}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    
                                    {/* Show quote if available */}
                                    {job.quote && (
                                        <div className="mb-2 p-2 bg-indigo-50 border border-indigo-200 rounded">
                                            <p className="text-xs font-bold text-indigo-900 mb-1">Quote:</p>
                                            <p className="text-xs text-indigo-700">£{job.quote.hourlyRate}/hr × {job.quote.estimatedHours}hrs = £{job.quote.total.toFixed(2)}</p>
                                            {job.quote.notes && <p className="text-xs text-indigo-600 mt-1">{job.quote.notes}</p>}
                                        </div>
                                    )}
                                    
                                    {/* Show booking if available */}
                                    {job.booking && (
                                        <div className="mb-2 p-2 bg-purple-50 border border-purple-200 rounded">
                                            <p className="text-xs font-bold text-purple-900">Booking: {job.booking.date} - {job.booking.timeSlot}</p>
                                        </div>
                                    )}
                                    
                                    {/* Show service location (address) to tradie after booking confirmed */}
                                    {isTradie && job.serviceLocation && ['InProgress', 'Completed'].includes(job.status) && (
                                        <div className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded">
                                            <p className="text-xs font-bold text-blue-900 mb-1">Service Location:</p>
                                            <p className="text-xs text-blue-800">{job.serviceLocation.address}</p>
                                            <p className="text-xs text-blue-800 mt-1">Phone: {job.serviceLocation.phone}</p>
                                            {job.serviceLocation.email && (
                                                <p className="text-xs text-blue-800">Email: {job.serviceLocation.email}</p>
                                            )}
                                        </div>
                                    )}
                                    </div>
                                    
                                    {/* Progress Tracker Sidebar */}
                                    <div className="w-32 flex-shrink-0 bg-slate-50 p-2 rounded border border-slate-200">
                                        <p className="text-xs font-bold text-slate-600 mb-2">Progress</p>
                                        <div className="space-y-1">
                                            {progressSteps.map((step, idx) => (
                                                <div key={idx} className="flex items-start gap-1 text-xs">
                                                    <span className="mt-0.5">
                                                        {step.status === 'complete' && <span className="text-green-600">✓</span>}
                                                        {step.status === 'skipped' && <span className="text-red-500">✗</span>}
                                                        {step.status === 'pending' && <span className="text-slate-300">○</span>}
                                                    </span>
                                                    <span className={step.status === 'complete' ? 'text-slate-700 font-medium' : 'text-slate-400'}>
                                                        {step.label}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Action Buttons Section - Full Width Below */}
                                <div className="mt-3">
                                    {/* ENHANCED WORKFLOW ACTIONS */}
                                    
                                    {/* Client: Approve or decline tradie who accepted from Job Board */}
                                    {isClient && job.status === 'TradieAccepted' && (
                                        <div className="flex gap-2 mt-2">
                                            <Button variant="danger" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => { setJobToDecline(job); setShowDeclineModal(true); }}>
                                                Decline Offer
                                            </Button>
                                            <Button variant="success" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => handleStatusUpdate(job.id, 'Pending')}>
                                                Accept Offer
                                            </Button>
                                        </div>
                                    )}
                                    
                                    {/* Tradie: Initial response to Pending */}
                                    {isTradie && job.status === 'Pending' && (
                                        <div className="flex gap-2 mt-2">
                                            <Button variant="danger" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => { setJobToDecline(job); setShowDeclineModal(true); }}>
                                                Decline
                                            </Button>
                                            <Button variant="ghost" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => {
                                                    setUserToBlock({
                                                        uid: job.clientUid,
                                                        name: job.clientName
                                                    });
                                                    setShowBlockConfirm(true);
                                                }}>
                                                Block
                                            </Button>
                                            <Button variant="success" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => handleStatusUpdate(job.id, 'Accepted')}>
                                                Accept
                                            </Button>
                                        </div>
                                    )}
                                    
                                    {/* Tradie: After accepting - can request info or quote */}
                                    {isTradie && job.status === 'Accepted' && (
                                        <div className="flex gap-2 mt-2">
                                            <Button variant="secondary" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => handleRequestInfo(job.id)}>
                                                Request Info/Photos
                                            </Button>
                                            <Button variant="primary" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => { setJobForQuote(job); setShowQuoteModal(true); }}>
                                                Quote Price
                                            </Button>
                                        </div>
                                    )}
                                    
                                    {/* Client: Provide info when requested */}
                                    {isClient && job.status === 'InfoRequested' && (
                                        <Button variant="primary" className="w-full py-1 text-xs mt-2" 
                                            onClick={() => { setJobForInfoRequest(job); setShowInfoRequestModal(true); }}>
                                            Upload Photos & Info
                                        </Button>
                                    )}
                                    
                                    {/* Tradie: Review info and quote or decline */}
                                    {isTradie && job.status === 'InfoProvided' && (
                                        <div className="flex gap-2 mt-2">
                                            <Button variant="danger" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => { setJobToDecline(job); setShowDeclineModal(true); }}>
                                                Decline Job
                                            </Button>
                                            <Button variant="success" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => { setJobForQuote(job); setShowQuoteModal(true); }}>
                                                Quote Price
                                            </Button>
                                        </div>
                                    )}
                                    
                                    {/* Client: Accept or decline quote */}
                                    {isClient && job.status === 'QuoteProvided' && (
                                        <div className="flex gap-2 mt-2">
                                            <Button variant="danger" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => handleDeclineQuote(job.id)}>
                                                Decline Quote
                                            </Button>
                                            <Button variant="success" className="py-1 px-3 text-xs flex-1" 
                                                onClick={() => handleAcceptQuote(job.id)}>
                                                Accept Quote
                                            </Button>
                                        </div>
                                    )}
                                    
                                    {/* Client: Select booking time */}
                                    {isClient && job.status === 'QuoteAccepted' && (
                                        <Button variant="primary" className="w-full py-1 text-xs mt-2" 
                                            onClick={() => { setJobForBooking(job); setShowBookingModal(true); }}>
                                            Select Date & Time
                                        </Button>
                                    )}
                                    
                                    {/* Tradie: Confirm booking */}
                                    {isTradie && job.status === 'BookingRequested' && (
                                        <Button variant="success" className="w-full py-1 text-xs mt-2" 
                                            onClick={() => handleConfirmBooking(job.id)}>
                                            Confirm Booking
                                        </Button>
                                    )}
                                    
                                    {/* Client: Make payment */}
                                    {isClient && job.status === 'BookingConfirmed' && (
                                        <Button variant="primary" className="w-full py-1 text-xs mt-2" 
                                            onClick={() => { setJobForPayment(job); setShowPaymentModal(true); }}>
                                            Pay Now - £{job.quote?.total.toFixed(2)}
                                        </Button>
                                    )}
                                    
                                    {/* Show payment complete status */}
                                    {job.status === 'PaymentComplete' && (
                                        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-center">
                                            <CheckCircle className="inline-block text-green-600 mb-1" size={16} />
                                            <p className="text-xs text-green-700 font-medium">Payment Complete - £{job.paymentAmount?.toFixed(2)}</p>
                                        </div>
                                    )}
                                    
                                    {/* Only client can mark Completed when InProgress */}
                                    {job.status === 'InProgress' && isClient && (
                                        <Button variant="success" className="w-full py-1 text-xs mt-2" 
                                            onClick={() => handleStatusUpdate(job.id, 'Completed')}>
                                            Mark as Completed
                                        </Button>
                                    )}
                                    
                                    {/* Show review prompt when completed and awaiting review */}
                                    {needsReview && (
                                        <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                                            <p className="text-sm font-bold text-orange-900 mb-2">How was your experience?</p>
                                            <Button variant="secondary" className="w-full py-2 text-xs"
                                                onClick={() => {
                                                    setJobToReview(job);
                                                    setShowReviewModal(true);
                                                }}>
                                                Leave a Review
                                            </Button>
                                        </div>
                                    )}
                                    
                                    {/* Show review submitted confirmation */}
                                    {job.status === 'Completed' && hasReviewed && (
                                        <div className="mt-3 p-3 bg-green-50 border-green-200 rounded-lg text-center">
                                            <CheckCircle className="inline-block text-green-600 mb-1" size={16} />
                                            <p className="text-xs text-green-700 font-medium">Review submitted</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* Block Confirmation Modal */}
            {showBlockConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
                        <h3 className="text-lg font-bold text-slate-900 mb-2">Block User?</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Block {userToBlock?.name}? They won't be able to contact you anymore.
                        </p>
                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1" onClick={() => { setShowBlockConfirm(false); setUserToBlock(null); }}>
                                Cancel
                            </Button>
                            <Button variant="danger" className="flex-1" onClick={handleBlockFromJob}>
                                Block
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Review Modal - Cannot be dismissed, review is mandatory */}
            {showReviewModal && jobToReview && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 animate-in fade-in zoom-in">
                        <div className="mb-4">
                            <h3 className="text-xl font-black text-slate-900">Leave a Review</h3>
                            <p className="text-xs text-slate-500 mt-1">Review required to complete this job</p>
                        </div>
                        
                        <div className="mb-6">
                            <p className="text-sm text-slate-600 mb-1">
                                How was your experience with <span className="font-bold">
                                    {jobToReview.tradieUid === user.uid ? jobToReview.clientName : jobToReview.tradieName}
                                </span>?
                            </p>
                            <p className="text-xs text-slate-500">{jobToReview.title}</p>
                        </div>

                        {/* Star Rating */}
                        <div className="mb-6">
                            <label className="block text-sm font-bold text-slate-700 mb-3">Rating</label>
                            <div className="flex gap-2 justify-center">
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <button
                                        key={star}
                                        onClick={() => setReviewData({ ...reviewData, rating: star })}
                                        className="transition-transform hover:scale-110"
                                    >
                                        <Star
                                            size={40}
                                            className={star <= reviewData.rating 
                                                ? 'fill-orange-500 text-orange-500' 
                                                : 'text-slate-300'
                                            }
                                        />
                                    </button>
                                ))}
                            </div>
                            <p className="text-center text-sm text-slate-600 mt-2 font-medium">
                                {reviewData.rating === 5 ? 'Excellent!' : 
                                 reviewData.rating === 4 ? 'Good' : 
                                 reviewData.rating === 3 ? 'Okay' : 
                                 reviewData.rating === 2 ? 'Poor' : 'Very Poor'}
                            </p>
                        </div>

                        {/* Comment */}
                        <div className="mb-6">
                            <label className="block text-sm font-bold text-slate-700 mb-2">
                                Comment (Optional)
                            </label>
                            <textarea
                                value={reviewData.comment}
                                onChange={(e) => setReviewData({ ...reviewData, comment: e.target.value })}
                                placeholder="Share details about your experience..."
                                rows={4}
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm"
                                maxLength={500}
                            />
                            <p className="text-xs text-slate-400 mt-1 text-right">
                                {reviewData.comment.length}/500
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1" onClick={() => {
                                setShowReviewModal(false);
                                setJobToReview(null);
                                setReviewData({ rating: 5, comment: '' });
                            }}>
                                Skip
                            </Button>
                            <Button variant="secondary" className="flex-1" onClick={handleSubmitReview}>
                                Submit Review
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Info Request Modal (Client uploads photos/info) */}
            {showInfoRequestModal && jobForInfoRequest && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-black text-slate-900">Upload Photos & Info</h3>
                            <button onClick={() => { setShowInfoRequestModal(false); setInfoPhotos([]); setInfoDescription(''); }}>
                                <X className="text-slate-400 hover:text-slate-600" />
                            </button>
                        </div>
                        
                        <p className="text-sm text-slate-600 mb-4">Upload photos and additional details about the job.</p>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Photos (up to 5)</label>
                            <input type="file" accept="image/*" multiple onChange={handleImageUpload} 
                                className="w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100" />
                            {infoPhotos.length > 0 && (
                                <div className="flex gap-2 mt-2 flex-wrap">
                                    {infoPhotos.map((photo, idx) => (
                                        <div key={idx} className="relative">
                                            <img src={photo} className="w-16 h-16 object-cover rounded border" />
                                            <button onClick={() => setInfoPhotos(infoPhotos.filter((_, i) => i !== idx))}
                                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Additional Info</label>
                            <textarea value={infoDescription} onChange={(e) => setInfoDescription(e.target.value)}
                                placeholder="Describe the location, access, specific requirements..."
                                rows={4} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" />
                        </div>
                        
                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1" onClick={() => { setShowInfoRequestModal(false); setInfoPhotos([]); setInfoDescription(''); }}>
                                Cancel
                            </Button>
                            <Button variant="primary" className="flex-1" onClick={handleSubmitInfo} disabled={infoPhotos.length === 0}>
                                Commit
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Quote Modal (Tradie submits quote) */}
            {showQuoteModal && jobForQuote && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-black text-slate-900">Submit Quote</h3>
                            <button onClick={() => { setShowQuoteModal(false); setQuoteData({ hourlyRate: '', estimatedHours: '', notes: '' }); }}>
                                <X className="text-slate-400 hover:text-slate-600" />
                            </button>
                        </div>
                        
                        <p className="text-sm text-slate-600 mb-4">Provide pricing for: <span className="font-bold">{jobForQuote.title}</span></p>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Hourly Rate (£)</label>
                            <input type="number" value={quoteData.hourlyRate} onChange={(e) => setQuoteData({ ...quoteData, hourlyRate: e.target.value })}
                                placeholder="e.g. 50" className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" />
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Estimated Hours</label>
                            <input type="number" value={quoteData.estimatedHours} onChange={(e) => setQuoteData({ ...quoteData, estimatedHours: e.target.value })}
                                placeholder="e.g. 4" className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" />
                        </div>
                        
                        {quoteData.hourlyRate && quoteData.estimatedHours && (
                            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                                <p className="text-sm font-bold text-green-900">Total: £{(parseFloat(quoteData.hourlyRate) * parseFloat(quoteData.estimatedHours)).toFixed(2)}</p>
                            </div>
                        )}
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Notes (Optional)</label>
                            <textarea value={quoteData.notes} onChange={(e) => setQuoteData({ ...quoteData, notes: e.target.value })}
                                placeholder="Include materials, special considerations..."
                                rows={3} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" />
                        </div>
                        
                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1" onClick={() => { setShowQuoteModal(false); setQuoteData({ hourlyRate: '', estimatedHours: '', notes: '' }); }}>
                                Cancel
                            </Button>
                            <Button variant="success" className="flex-1" onClick={handleSubmitQuote} 
                                disabled={!quoteData.hourlyRate || !quoteData.estimatedHours}>
                                Submit Quote
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Decline Modal (Tradie provides reason) */}
            {showDeclineModal && jobToDecline && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-black text-slate-900">Decline Job</h3>
                            <button onClick={() => { setShowDeclineModal(false); setDeclineReason(''); }}>
                                <X className="text-slate-400 hover:text-slate-600" />
                            </button>
                        </div>
                        
                        <p className="text-sm text-slate-600 mb-4">Please provide a reason for declining this job.</p>
                        
                        <div className="mb-4">
                            <textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}
                                placeholder="e.g. Outside my service area, job too small, already booked..."
                                rows={4} className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" 
                                required />
                        </div>
                        
                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1" onClick={() => { setShowDeclineModal(false); setDeclineReason(''); }}>
                                Cancel
                            </Button>
                            <Button variant="danger" className="flex-1" onClick={handleDeclineJob} disabled={!declineReason.trim()}>
                                Decline Job
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Booking Modal (Client selects date/time and provides service location) */}
            {showBookingModal && jobForBooking && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-black text-slate-900">Booking Details</h3>
                            <button onClick={() => { 
                                setShowBookingModal(false); 
                                setSelectedDate(null); 
                                setSelectedTimeSlot(''); 
                                setServiceAddress('');
                                setServicePhone('');
                                setServiceEmail('');
                            }}>
                                <X className="text-slate-400 hover:text-slate-600" />
                            </button>
                        </div>
                        
                        <p className="text-sm text-slate-600 mb-4">Provide service location and select date & time.</p>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Service Address <span className="text-red-500">*</span></label>
                            <textarea 
                                value={serviceAddress} 
                                onChange={(e) => setServiceAddress(e.target.value)}
                                placeholder="Enter the full address where work will be done"
                                rows={3}
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" 
                            />
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Phone Number <span className="text-red-500">*</span></label>
                            <input 
                                type="tel" 
                                value={servicePhone} 
                                onChange={(e) => setServicePhone(e.target.value)}
                                placeholder="e.g., 07123 456789"
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" 
                            />
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Email (Optional)</label>
                            <input 
                                type="email" 
                                value={serviceEmail} 
                                onChange={(e) => setServiceEmail(e.target.value)}
                                placeholder={user?.email || "your@email.com"}
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" 
                            />
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Date <span className="text-red-500">*</span></label>
                            <input type="date" value={selectedDate || ''} onChange={(e) => setSelectedDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm" />
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Time Slot <span className="text-red-500">*</span></label>
                            <select value={selectedTimeSlot} onChange={(e) => setSelectedTimeSlot(e.target.value)}
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm">
                                <option value="">Select a time slot</option>
                                <option value="Morning (8AM-12PM)">Morning (8AM-12PM)</option>
                                <option value="Afternoon (12PM-8PM)">Afternoon (12PM-8PM)</option>
                                <option value="Evening (8PM-11PM)">Evening (8PM-11PM)</option>
                            </select>
                        </div>
                        
                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1" onClick={() => { 
                                setShowBookingModal(false); 
                                setSelectedDate(null); 
                                setSelectedTimeSlot(''); 
                                setServiceAddress('');
                                setServicePhone('');
                                setServiceEmail('');
                            }}>
                                Cancel
                            </Button>
                            <Button variant="primary" className="flex-1" onClick={handleSubmitBooking} 
                                disabled={!selectedDate || !selectedTimeSlot || !serviceAddress.trim() || !servicePhone.trim()}>
                                Request Booking
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Payment Modal (Client pays) */}
            {showPaymentModal && jobForPayment && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-black text-slate-900">Complete Payment</h3>
                            {!processingPayment && (
                                <button onClick={() => setShowPaymentModal(false)}>
                                    <X className="text-slate-400 hover:text-slate-600" />
                                </button>
                            )}
                        </div>
                        
                        <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                            <p className="text-sm text-slate-600 mb-2">Job: <span className="font-bold">{jobForPayment.title}</span></p>
                            <p className="text-sm text-slate-600 mb-2">Tradie: <span className="font-bold">{jobForPayment.tradieName}</span></p>
                            <p className="text-2xl font-black text-slate-900 mt-4">£{jobForPayment.quote?.total.toFixed(2)}</p>
                            <p className="text-xs text-slate-500">£{jobForPayment.quote?.hourlyRate}/hr × {jobForPayment.quote?.estimatedHours}hrs</p>
                        </div>
                        
                        <p className="text-xs text-slate-500 mb-4 text-center">
                            💳 Payment will be processed via Stripe<br />
                            (Simulated for demo - no actual charge)
                        </p>
                        
                        <Button variant="success" className="w-full" onClick={handleProcessPayment} disabled={processingPayment}>
                            {processingPayment ? (
                                <><Clock className="animate-spin" size={16} /> Processing Payment...</>
                            ) : (
                                <>Pay £{jobForPayment.quote?.total.toFixed(2)}</>
                            )}
                        </Button>
                    </div>
                </div>
            )}
            
            {/* Photo Gallery Modal */}
            {showPhotoGallery && (
                <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4">
                    <div className="relative w-full max-w-2xl">
                        <button onClick={() => setShowPhotoGallery(false)} 
                            className="absolute -top-10 right-0 text-white hover:text-gray-300">
                            <X size={32} />
                        </button>
                        <div className="bg-white rounded-2xl p-4">
                            <div className="grid grid-cols-2 gap-4">
                                {galleryPhotos.map((photo, idx) => (
                                    <img key={idx} src={photo} className="w-full h-auto rounded border" />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const ChatList = ({ user, onSelectChat }) => {
  const [chats, setChats] = useState([]);
  useEffect(() => {
      if (!db) return;
      const unsub = onSnapshot(collection(db, 'artifacts', getAppId(), 'public', 'data', 'chats'), (snap) => {
          const myChats = snap.docs.map(d => ({id: d.id, ...d.data()})).filter(c => c.participants && c.participants.includes(user.uid));
          setChats(myChats);
      });
      return () => unsub();
  }, [user]);

  return (
    <div className="flex flex-col h-full">
        <div className="p-4 border-b border-slate-200"><h2 className="font-bold text-lg">Messages</h2></div>
        <div className="flex-1 p-4 overflow-y-auto">
             {chats.length === 0 ? (
                 <div className="text-center text-slate-400 mt-10"><MessageCircle size={48} className="mx-auto mb-2 opacity-50" /><p>No active chats.</p></div>
             ) : (
                 chats.map(chat => {
                     const partnerId = chat.participants.find(p => p !== user.uid);
                     return (
                         <div key={chat.id} onClick={() => onSelectChat({ uid: partnerId, name: chat.partnerName || 'User', id: chat.id })} className="p-4 border-b border-slate-100 flex items-center gap-3 hover:bg-slate-50 cursor-pointer">
                             <div className="w-12 h-12 flex items-center justify-center bg-slate-100 rounded-full"><User size={24} className="text-slate-400"/></div>
                             <div><h4 className="font-bold text-slate-800">{chat.partnerName || 'User'}</h4><p className="text-xs text-slate-500 truncate w-48">{chat.lastMessage}</p></div>
                         </div>
                     )
                 })
             )}
        </div>
    </div>
  );
};

const ChatRoom = ({ user, partner, onBack }) => {
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [showBlockConfirm, setShowBlockConfirm] = useState(false);
    const chatId = [user.uid, partner.uid].sort().join('_'); 
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!db) return;
        const chatRef = doc(db, 'artifacts', getAppId(), 'public', 'data', 'chats', chatId);
        setDoc(chatRef, { participants: [user.uid, partner.uid], partnerName: partner.name || partner.username || 'User', updatedAt: serverTimestamp() }, { merge: true });
        const q = query(collection(db, 'artifacts', getAppId(), 'public', 'data', 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(q, (snap) => {
            setMessages(snap.docs.map(d => d.data()));
            setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
        });
        return () => unsub();
    }, [user, partner]);

    const sendMessage = async () => {
        if(!inputText.trim()) return;
        
        // Check email verification - reload user first to get latest status
        if (user) {
            try {
                await user.reload();
                const updatedUser = auth.currentUser;
                
                if (updatedUser && !updatedUser.emailVerified) {
                    alert('Please verify your email before sending messages. Check your inbox for the verification link.');
                    return;
                }
            } catch (err) {
                console.error('Error checking verification:', err);
                // If reload fails, fall back to cached status
                if (!user.emailVerified) {
                    alert('Please verify your email before sending messages. Check your inbox for the verification link.');
                    return;
                }
            }
        }
        
        const text = inputText;
        setInputText('');
        await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'chats', chatId, 'messages'), { text, senderId: user.uid, createdAt: serverTimestamp() });
        await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'chats', chatId), { lastMessage: text, updatedAt: serverTimestamp() });
    };

    const handleBlockUser = async () => {
        try {
            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users'), {
                blockedBy: user.uid,
                blockedUser: partner.uid,
                blockedUserName: partner.name || partner.username,
                blockedAt: serverTimestamp(),
                source: 'chat'
            });
            setShowBlockConfirm(false);
            onBack();
        } catch (error) {
            console.error("Error blocking user:", error);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white z-[70] absolute inset-0">
            <div className="p-4 border-b border-slate-200 flex items-center gap-2 bg-white shadow-sm">
                <button onClick={onBack}><ArrowRight className="rotate-180 text-slate-500" /></button>
                <span className="font-bold flex-1">{partner.name || partner.username}</span>
                <button
                    onClick={() => setShowBlockConfirm(true)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Block user"
                >
                    <Ban size={20} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.senderId === user.uid ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${m.senderId === user.uid ? 'bg-slate-900 text-white rounded-br-none' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none'}`}>{m.text}</div>
                    </div>
                ))}
                <div ref={scrollRef} />
            </div>
            <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
                <input className="flex-1 p-3 bg-slate-100 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm" placeholder="Type a message..." value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} />
                <button onClick={sendMessage} className="p-3 bg-orange-500 text-white rounded-full hover:bg-orange-600 transition-colors shadow-lg shadow-orange-200"><Send size={18} /></button>
            </div>

            {/* Block Confirmation Modal */}
            {showBlockConfirm && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
                        <h3 className="text-lg font-bold text-slate-900 mb-2">Block User?</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            You won't be able to message each other or see each other's profiles.
                        </p>
                        <div className="flex gap-2">
                            <Button variant="ghost" className="flex-1" onClick={() => setShowBlockConfirm(false)}>
                                Cancel
                            </Button>
                            <Button variant="danger" className="flex-1" onClick={handleBlockUser}>
                                Block
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// UPDATED: UserProfile now accepts onEnableLocation to fix the button in view
const UserProfile = ({ user, profile, onLogout, showToast, onEnableLocation, onNavigate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({});
    const [isVerifying, setIsVerifying] = useState(false); // Modal state for verification
    const [verificationDocs, setVerificationDocs] = useState({ front: null, back: null }); // Store verification docs
    const photoInputRef = useRef(null);
    const coverInputRef = useRef(null);
    const verifyFrontRef = useRef(null);
    const verifyBackRef = useRef(null);

    useEffect(() => { if(profile) setEditData(profile); }, [profile]);

    const handleSave = async () => {
        await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), editData);
        setIsEditing(false);
        showToast("Profile Updated!", "success");
    };

    // UPDATED: Logic to handle Verification Request with actual file upload
    const handleVerifySubmit = async () => {
        if (!verificationDocs.front || !verificationDocs.back) {
            showToast("Please upload both front and back of ID", "error");
            return;
        }
        
        // In production, these would be uploaded to Firebase Storage or S3
        // For now, we store them as base64 in the profile document
        await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), {
            verificationStatus: 'pending_review',
            verificationDocuments: {
                front: verificationDocs.front,
                back: verificationDocs.back,
                submittedAt: serverTimestamp()
            }
        });
        setIsVerifying(false);
        setVerificationDocs({ front: null, back: null });
        showToast("Documents sent for review!", "success");
    };

    const handleVerificationUpload = (e, side) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check file size (max 5MB)
        if (file.size > MAX_VERIFICATION_FILE_SIZE) {
            showToast("File too large. Max 5MB.", "error");
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (event) => {
            setVerificationDocs(prev => ({...prev, [side]: event.target.result}));
            showToast(`${side === 'front' ? 'Front' : 'Back'} uploaded`, "success");
        };
        reader.readAsDataURL(file);
    };

    const handleImageUpload = async (e, field) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Show loading state
        showToast("Compressing and uploading image...", "info");
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                let imageData = event.target.result;
                
                // Always compress to 10KB target size
                imageData = await compressImage(imageData, 10 * 1024); // 10KB
                
                // Update local state first
                setEditData(prev => ({...prev, [field]: imageData}));
                
                // Then save to Firebase and wait for completion
                await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), {
                    [field]: imageData
                });
                
                showToast("Image uploaded successfully!", "success");
            } catch (error) {
                console.error("Error uploading image:", error);
                showToast("Failed to upload image", "error");
            }
        };
        reader.readAsDataURL(file);
    };
    
    // Helper function to compress images to target size
    const compressImage = (base64Image, targetSizeBytes) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Estimate current size and calculate aggressive scaling if needed
                const currentSize = base64Image.length * BASE64_SIZE_RATIO;
                
                // Start with aggressive downscaling for 10KB target
                if (currentSize > targetSizeBytes) {
                    // Use more aggressive scaling factor for small targets like 10KB
                    const scaleFactor = Math.sqrt(targetSizeBytes / currentSize) * 0.8;
                    width = Math.max(50, Math.floor(width * scaleFactor)); // Minimum 50px
                    height = Math.max(50, Math.floor(height * scaleFactor));
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Compress with quality adjustment to hit target size
                let quality = 0.7; // Start with lower quality for 10KB target
                let compressedData = canvas.toDataURL('image/jpeg', quality);
                
                // Reduce quality until we're under target size
                while (compressedData.length * BASE64_SIZE_RATIO > targetSizeBytes && quality > 0.05) {
                    quality -= 0.05;
                    compressedData = canvas.toDataURL('image/jpeg', quality);
                }
                
                resolve(compressedData);
            };
            img.src = base64Image;
        });
    };

    if (!profile) return null;

    return (
        <div className="p-4 pb-20 relative">
            {/* UPDATED: Verification Modal */}
            {isVerifying && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in">
                        <div className="flex justify-between items-center mb-4">
                             <h3 className="text-xl font-black text-slate-900">Verify Trade ID</h3>
                             <button onClick={() => { setIsVerifying(false); setVerificationDocs({ front: null, back: null }); }}>
                                <X className="text-slate-400 hover:text-slate-600" />
                             </button>
                        </div>
                        <p className="text-sm text-slate-600 mb-6">Upload a photo of your Trade ID card (CSCS, Gas Safe, etc) to get the Verified Badge.</p>
                        
                        <button 
                            onClick={() => verifyFrontRef.current?.click()}
                            className="w-full border-2 border-dashed border-slate-200 rounded-xl h-32 flex flex-col items-center justify-center text-slate-400 mb-4 bg-slate-50 hover:border-orange-500 hover:bg-orange-50 transition-all"
                        >
                             {verificationDocs.front ? (
                                <div className="text-center">
                                    <CheckCircle className="mx-auto mb-2 text-green-600" size={32} />
                                    <span className="text-xs font-bold text-green-700">Front Uploaded ✓</span>
                                </div>
                             ) : (
                                <>
                                    <UploadCloud size={32} className="mb-2" />
                                    <span className="text-xs font-bold">Tap to Upload Front</span>
                                </>
                             )}
                        </button>
                        
                        <button 
                            onClick={() => verifyBackRef.current?.click()}
                            className="w-full border-2 border-dashed border-slate-200 rounded-xl h-32 flex flex-col items-center justify-center text-slate-400 mb-6 bg-slate-50 hover:border-orange-500 hover:bg-orange-50 transition-all"
                        >
                             {verificationDocs.back ? (
                                <div className="text-center">
                                    <CheckCircle className="mx-auto mb-2 text-green-600" size={32} />
                                    <span className="text-xs font-bold text-green-700">Back Uploaded ✓</span>
                                </div>
                             ) : (
                                <>
                                    <UploadCloud size={32} className="mb-2" />
                                    <span className="text-xs font-bold">Tap to Upload Back</span>
                                </>
                             )}
                        </button>

                        <input type="file" ref={verifyFrontRef} onChange={(e) => handleVerificationUpload(e, 'front')} accept="image/*" className="hidden" />
                        <input type="file" ref={verifyBackRef} onChange={(e) => handleVerificationUpload(e, 'back')} accept="image/*" className="hidden" />

                        <Button 
                            onClick={handleVerifySubmit} 
                            className="w-full"
                            variant={verificationDocs.front && verificationDocs.back ? "secondary" : "primary"}
                            disabled={!verificationDocs.front || !verificationDocs.back}
                        >
                            Submit for Review
                        </Button>
                    </div>
                </div>
            )}

            <div className="flex flex-col items-center mb-6 relative">
                <button onClick={() => setIsEditing(!isEditing)} className="absolute right-0 top-0 p-2 text-slate-400 hover:text-orange-500 z-10"><Edit2 size={20} /></button>
                
                {/* Cover Photo Area (Preview) */}
                <div className="w-full h-32 bg-slate-200 mb-8 rounded-xl relative overflow-hidden group border border-slate-300">
                    {(isEditing ? editData.coverPhoto : profile.coverPhoto) ? (
                        <img src={isEditing ? editData.coverPhoto : profile.coverPhoto} className="w-full h-full object-cover" alt="Cover"/>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">No Cover Photo</div>
                    )}
                    {isEditing && (
                        <button onClick={() => coverInputRef.current?.click()} className="absolute inset-0 bg-black/30 flex items-center justify-center text-white font-bold text-xs gap-2">
                            <ImageIcon size={16}/> Change Cover
                        </button>
                    )}
                </div>

                <div className={`relative mb-3 group -mt-16`}>
                    <Avatar profile={isEditing ? editData : profile} size="xl" className="shadow-lg border-4 border-white w-24 h-24" showEditIcon={!isEditing} />
                    
                    {/* Busy/DND Badge */}
                    {profile.role === 'tradie' && !isEditing && (() => {
                        const currentlyUnavailable = isCurrentlyUnavailable(profile.workCalendar);
                        if (currentlyUnavailable) {
                            return (
                                <div className="absolute -bottom-1 -right-1 bg-red-500 text-white p-1.5 rounded-full shadow-lg border-2 border-white" title="Currently Unavailable">
                                    <Ban size={14} />
                                </div>
                            );
                        }
                        return null;
                    })()}
                    
                    {isEditing && (
                        <button onClick={() => photoInputRef.current?.click()} className="absolute bottom-0 right-0 bg-orange-500 text-white p-2 rounded-full shadow-md hover:bg-orange-600 transition-colors border-2 border-white"><Camera size={16} /></button>
                    )}
                    <input type="file" ref={photoInputRef} onChange={(e) => handleImageUpload(e, 'primaryPhoto')} accept="image/*" className="hidden" />
                    <input type="file" ref={coverInputRef} onChange={(e) => handleImageUpload(e, 'coverPhoto')} accept="image/*" className="hidden" />
                </div>
                
                {isEditing ? (
                    <div className="w-full space-y-3 animate-in fade-in duration-300">
                        <Input label="Name" value={editData.name || editData.username} onChange={e => setEditData({...editData, name: e.target.value})} />
                        <Input label="Bio" textarea value={editData.bio} onChange={e => setEditData({...editData, bio: e.target.value})} />
                        {profile.role === 'tradie' && <Input label="Hourly Rate" type="number" value={editData.rate} onChange={e => setEditData({...editData, rate: e.target.value})} />}
                        
                        <div className="bg-slate-100 p-3 rounded-lg flex items-center justify-between">
                            <span className="text-sm font-bold text-slate-700">GPS Location</span>
                            <button onClick={onEnableLocation} className="text-xs bg-slate-900 text-white px-3 py-2 rounded flex items-center gap-1"><Navigation size={12}/> Update</button>
                        </div>

                        <div className="flex gap-2 pt-2">
                            <Button variant="ghost" className="flex-1" onClick={() => setIsEditing(false)}>Cancel</Button>
                            <Button variant="secondary" className="flex-1" onClick={handleSave}>Save Changes</Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <h2 className="text-2xl font-black flex items-center gap-2 text-slate-900">{profile.name || profile.username}, {profile.age} {profile.verified && <ShieldCheck size={20} className="text-blue-500 fill-blue-100" />}</h2>
                        <p className="text-slate-500 text-sm capitalize font-medium">{profile.role} • {profile.location}</p>
                        {profile.role === 'tradie' && <p className="font-mono text-slate-800 font-bold mt-1">£{profile.rate}/hr</p>}
                        <p className="text-center text-slate-600 mt-3 text-sm max-w-xs leading-relaxed">{profile.bio}</p>
                        
                        {/* Not Available Banner for Tradies */}
                        {profile.role === 'tradie' && (() => {
                            const currentlyUnavailable = isCurrentlyUnavailable(profile.workCalendar);
                            if (currentlyUnavailable) {
                                const unavailabilityInfo = getCurrentUnavailabilityInfo(profile.workCalendar);
                                const nextAvailable = getNextAvailableDateTime(profile.workCalendar);
                                const isOnJob = unavailabilityInfo?.reason === 'job';
                                
                                if (nextAvailable) {
                                    return (
                                        <div className={`mt-4 w-full border-2 rounded-xl p-3 ${isOnJob ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                                            <div className="flex items-center gap-2 justify-center">
                                                <Ban size={16} className={isOnJob ? 'text-blue-600' : 'text-red-600'} />
                                                <div className="text-center">
                                                    <p className={`text-xs font-bold ${isOnJob ? 'text-blue-900' : 'text-red-900'}`}>
                                                        {isOnJob ? "On a job! I'll be available for Hire from:" : "Not Available for Hire until:"}
                                                    </p>
                                                    <p className={`text-sm font-black ${isOnJob ? 'text-blue-700' : 'text-red-700'}`}>
                                                        {nextAvailable.date.toLocaleDateString('en-GB', { 
                                                            weekday: 'short',
                                                            month: 'short', 
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        })} at {formatTimeSlot(nextAvailable.timeSlot)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            return null;
                        })()}
                    </>
                )}
                
                {/* UPDATED: Verify Button Logic */}
                {profile.role === 'tradie' && !profile.verified && (
                    <div className="mt-4 w-full bg-slate-100 p-4 rounded-xl border border-slate-200 text-center">
                        {profile.verificationStatus === 'pending_review' ? (
                            <>
                                <div className="mx-auto bg-yellow-100 w-10 h-10 rounded-full flex items-center justify-center mb-2"><CheckCircle className="text-yellow-600" size={20} /></div>
                                <p className="text-sm font-bold text-slate-700">Verification Pending</p>
                                <p className="text-xs text-slate-500">We are reviewing your ID documents.</p>
                            </>
                        ) : (
                            <>
                                <p className="text-sm font-bold text-slate-700 mb-2">Get Verified & Boost Bookings</p>
                                <Button onClick={() => setIsVerifying(true)} variant="primary" className="w-full text-sm py-2">Verify Trade ID</Button>
                            </>
                        )}
                    </div>
                )}
            </div>
            <div className="space-y-2 mb-8">
                <ProfileLink icon={Settings} label="Settings" onClick={() => onNavigate('settings')} />
                {profile.role === 'tradie' && (
                    <ProfileLink icon={Calendar} label="Work Calendar" onClick={() => onNavigate('workCalendar')} />
                )}
                {profile.role === 'tradie' && (
                    <ProfileLink icon={DollarSign} label="Payments & Credits" onClick={() => onNavigate('paymentsCredits')} />
                )}
                <ProfileLink icon={ShieldCheck} label="Safety Centre" onClick={() => onNavigate('safety')} />
                <button onClick={onLogout} className="w-full p-4 flex items-center gap-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors font-bold"><LogOut size={20} /> <span className="font-medium">Sign Out</span></button>
            </div>
        </div>
    );
};

const ProfileLink = ({ icon: Icon, label, onClick }) => (
    <button onClick={onClick} className="w-full p-4 flex items-center justify-between bg-white border border-slate-100 rounded-xl shadow-sm hover:border-slate-300 transition-all group">
        <div className="flex items-center gap-3 text-slate-700 font-medium group-hover:text-slate-900"><Icon size={20} /> <span>{label}</span></div><ArrowRight size={16} className="text-slate-400 group-hover:text-slate-600" />
    </button>
);

const ServiceFinder = ({ onPostJob, onSelectService }) => (
  <div className="p-4">
    <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Search className="text-orange-500" /> Find a Service</h2>
    <div className="grid grid-cols-2 gap-3 mb-6">
        {TRADES.slice(0, 6).map(t => (
            <button key={t} onClick={() => onSelectService(t)} className="p-4 bg-white border border-slate-200 rounded-xl text-left hover:border-orange-500 hover:shadow-md transition-all group">
                <span className="font-bold text-slate-700 block group-hover:text-orange-600 transition-colors">{t}</span>
                <span className="text-xs text-slate-400">View pros</span>
            </button>
        ))}
    </div>
    <div className="bg-slate-900 text-white p-6 rounded-2xl relative overflow-hidden shadow-xl">
        <div className="relative z-10">
            <h3 className="font-bold text-lg mb-2">Need something custom?</h3>
            <p className="text-slate-400 text-sm mb-4">Post a job advert to the board.</p>
            <Button onClick={onPostJob} variant="secondary" className="w-full text-sm">Post a Job</Button>
        </div>
        <Wrench className="absolute -bottom-4 -right-4 text-slate-800 opacity-50" size={120} />
    </div>
  </div>
);

// --- SETTINGS SCREEN ---
const SettingsScreen = ({ user, profile, onBack, showToast }) => {
    const [settings, setSettings] = useState({
        // Location
        manualLocation: profile?.manualLocation || '',
        useManualLocation: profile?.useManualLocation || false,
        
        // Notifications
        notifyMessages: profile?.notifyMessages ?? true,
        notifyJobOffers: profile?.notifyJobOffers ?? true,
        notifyMatches: profile?.notifyMatches ?? true,
        
        // Privacy
        incognitoMode: profile?.incognitoMode || false,
        hideDistance: profile?.hideDistance || false,
        verifiedOnly: profile?.verifiedOnly || false,
        blurPhotos: profile?.blurPhotos || false,
        hideOnlineStatus: profile?.hideOnlineStatus || false,
        
        // Additional Privacy
        autoDeleteChats: profile?.autoDeleteChats || 'never',
        screenshotDetection: profile?.screenshotDetection || false,
        verifiedOnlyChats: profile?.verifiedOnlyChats || false,
        jobOnlyVisibility: profile?.jobOnlyVisibility || false,
    });

    const [blockedUsers, setBlockedUsers] = useState([]);
    const [activeSessions, setActiveSessions] = useState([]);
    const [showBlockedUsers, setShowBlockedUsers] = useState(false);
    const [showLoginHistory, setShowLoginHistory] = useState(false);

    // Load blocked users
    useEffect(() => {
        if (!user || !db) return;
        const unsub = onSnapshot(
            collection(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users'),
            (snapshot) => {
                const blocked = snapshot.docs
                    .filter(doc => doc.data().blockedBy === user.uid)
                    .map(doc => ({ id: doc.id, ...doc.data() }));
                setBlockedUsers(blocked);
            }
        );
        return () => unsub();
    }, [user]);

    // Load active sessions (mock data for now)
    useEffect(() => {
        // NOTE: This is placeholder/demo data. In production, implement proper session tracking
        setActiveSessions([
            { id: 'current', device: 'Current Device', location: 'Your Location', lastActive: 'Now', isCurrent: true },
        ]);
    }, []);

    const handleSaveSettings = async () => {
        try {
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), {
                ...settings,
                settingsUpdatedAt: serverTimestamp()
            });
            showToast("Settings saved!", "success");
        } catch (error) {
            console.error("Error saving settings:", error);
            showToast("Failed to save settings", "error");
        }
    };

    const handleUnblockUser = async (blockedUserId) => {
        try {
            await deleteDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users', blockedUserId));
            showToast("User unblocked", "success");
        } catch (error) {
            console.error("Error unblocking user:", error);
            showToast("Failed to unblock user", "error");
        }
    };

    const handleLogoutSession = async (sessionId) => {
        // In production, this would invalidate the session
        showToast("Session logged out", "success");
        setActiveSessions(prev => prev.filter(s => s.id !== sessionId));
    };

    const ToggleSwitch = ({ label, description, value, onChange, icon: Icon, disabled = false, badge = null }) => (
        <div className={`flex items-start justify-between py-3 border-b border-slate-100 last:border-0 ${disabled ? 'opacity-50' : ''}`}>
            <div className="flex-1 pr-4">
                <div className="flex items-center gap-2 mb-1">
                    {Icon && <Icon size={16} className="text-slate-500" />}
                    <h4 className="font-bold text-sm text-slate-800">{label}</h4>
                    {badge && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            badge === 'Android' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                            {badge === 'Android' ? 'Only on Android App' : 'Coming Soon'}
                        </span>
                    )}
                </div>
                {description && <p className="text-xs text-slate-500 leading-relaxed">{description}</p>}
            </div>
            <button
                onClick={() => !disabled && onChange(!value)}
                disabled={disabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    disabled ? 'bg-slate-200 cursor-not-allowed' : value ? 'bg-orange-500' : 'bg-slate-300'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        value ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
                <div className="p-4 flex items-center gap-3">
                    <button onClick={onBack}><ArrowRight className="rotate-180 text-slate-600" size={20} /></button>
                    <h1 className="text-xl font-bold text-slate-900">Settings</h1>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Location Controls */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                    <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <MapPin size={18} className="text-orange-500" /> Location Controls
                    </h3>
                    <ToggleSwitch
                        label="Use Manual Location"
                        description="Override GPS with a custom city/area"
                        value={settings.useManualLocation}
                        onChange={(val) => setSettings({ ...settings, useManualLocation: val })}
                        icon={Navigation}
                        disabled={true}
                        badge="Soon"
                    />
                    {settings.useManualLocation && (
                        <div className="mt-3">
                            <Input
                                label="Manual Location"
                                placeholder="e.g., Central London"
                                value={settings.manualLocation}
                                onChange={(e) => setSettings({ ...settings, manualLocation: e.target.value })}
                                disabled={true}
                            />
                        </div>
                    )}
                </div>

                {/* Notification Preferences */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                    <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <Bell size={18} className="text-orange-500" /> Notification Preferences
                    </h3>
                    <ToggleSwitch
                        label="Message Notifications"
                        description="Get notified when you receive messages"
                        value={settings.notifyMessages}
                        onChange={(val) => setSettings({ ...settings, notifyMessages: val })}
                        icon={MessageCircle}
                        disabled={true}
                        badge="Android"
                    />
                    <ToggleSwitch
                        label="Job Offer Notifications"
                        description="Get notified about new job offers"
                        value={settings.notifyJobOffers}
                        onChange={(val) => setSettings({ ...settings, notifyJobOffers: val })}
                        icon={Briefcase}
                        disabled={true}
                        badge="Android"
                    />
                    <ToggleSwitch
                        label="Match Notifications"
                        description="Get notified about new matches"
                        value={settings.notifyMatches}
                        onChange={(val) => setSettings({ ...settings, notifyMatches: val })}
                        icon={Heart}
                        disabled={true}
                        badge="Android"
                    />
                </div>

                {/* Privacy Controls */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                    <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <Lock size={18} className="text-orange-500" /> Privacy Controls
                    </h3>
                    <ToggleSwitch
                        label="Incognito Mode"
                        description="Hide your profile while still browsing others"
                        value={settings.incognitoMode}
                        onChange={(val) => setSettings({ ...settings, incognitoMode: val })}
                        icon={EyeOff}
                    />
                    <ToggleSwitch
                        label="Hide Distance"
                        description="Show region only instead of exact distance"
                        value={settings.hideDistance}
                        onChange={(val) => setSettings({ ...settings, hideDistance: val })}
                        icon={MapPin}
                    />
                    <ToggleSwitch
                        label="Verified Tradies Only"
                        description="Show your profile only to verified tradies"
                        value={settings.verifiedOnly}
                        onChange={(val) => setSettings({ ...settings, verifiedOnly: val })}
                        icon={ShieldCheck}
                    />
                    <ToggleSwitch
                        label="Photo Blur"
                        description="Blurs your profile picture and in Social"
                        value={settings.blurPhotos}
                        onChange={(val) => setSettings({ ...settings, blurPhotos: val })}
                        icon={Eye}
                    />
                    <ToggleSwitch
                        label="Hide Online Status"
                        description="Don't show when you're active"
                        value={settings.hideOnlineStatus}
                        onChange={(val) => setSettings({ ...settings, hideOnlineStatus: val })}
                        icon={Clock}
                    />
                    <ToggleSwitch
                        label="Job-Only Visibility"
                        description="Appear in Hire tab only, not Social feed"
                        value={settings.jobOnlyVisibility}
                        onChange={(val) => setSettings({ ...settings, jobOnlyVisibility: val })}
                        icon={Briefcase}
                    />
                    
                    {/* Login History */}
                    <div className="pt-3 mt-3 border-t border-slate-100">
                        <button
                            onClick={() => setShowLoginHistory(true)}
                            className="w-full flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Shield size={16} className="text-slate-600" />
                                <span className="font-bold text-sm text-slate-800">Login History</span>
                            </div>
                            <ChevronRight size={16} className="text-slate-400" />
                        </button>
                    </div>
                </div>

                {/* Blocked Users */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                    <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <Ban size={18} className="text-orange-500" /> Blocked Users
                    </h3>
                    <button
                        onClick={() => setShowBlockedUsers(true)}
                        className="w-full flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <UserX size={16} className="text-slate-600" />
                            <span className="font-bold text-sm text-slate-800">Manage Blocked Users</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold">
                                {blockedUsers.length}
                            </span>
                            <ChevronRight size={16} className="text-slate-400" />
                        </div>
                    </button>
                </div>

                {/* Additional Privacy Features */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                    <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                        <Shield size={18} className="text-orange-500" /> Additional Privacy
                    </h3>
                    
                    {/* Auto-delete chats */}
                    <div className="py-3 border-b border-slate-100 opacity-50">
                        <label className="block mb-2">
                            <div className="flex items-center gap-2 mb-1">
                                <Trash2 size={16} className="text-slate-500" />
                                <span className="font-bold text-sm text-slate-800">Auto-delete Chats</span>
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                                    Only on Android App
                                </span>
                            </div>
                            <p className="text-xs text-slate-500 mb-2">Automatically delete messages after</p>
                        </label>
                        <select
                            value={settings.autoDeleteChats}
                            onChange={(e) => setSettings({ ...settings, autoDeleteChats: e.target.value })}
                            className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                            disabled={true}
                        >
                            <option value="never">Never</option>
                            <option value="24h">24 hours</option>
                            <option value="48h">48 hours</option>
                            <option value="72h">72 hours</option>
                        </select>
                    </div>

                    <ToggleSwitch
                        label="Screenshot Detection"
                        description="Alert you when someone takes a screenshot (limited support)"
                        value={settings.screenshotDetection}
                        onChange={(val) => setSettings({ ...settings, screenshotDetection: val })}
                        icon={Camera}
                        disabled={true}
                        badge="Android"
                    />
                    <ToggleSwitch
                        label="Verified-Only Chats"
                        description="Only receive messages from verified profiles"
                        value={settings.verifiedOnlyChats}
                        onChange={(val) => setSettings({ ...settings, verifiedOnlyChats: val })}
                        icon={UserCheck}
                        disabled={true}
                        badge="Soon"
                    />
                </div>

                {/* Danger Zone - Delete Account */}
                <div className="bg-red-50 rounded-xl border-2 border-red-200 p-4">
                    <h3 className="font-bold text-red-900 mb-2 flex items-center gap-2">
                        <AlertTriangle size={18} className="text-red-600" /> Danger Zone
                    </h3>
                    <p className="text-red-700 text-sm mb-3">
                        Permanently delete your account and all associated data. This action cannot be undone.
                    </p>
                    <Button 
                        variant="danger" 
                        className="w-full py-3"
                        onClick={async () => {
                            if (!confirm('Are you absolutely sure? This will permanently delete your account, profile, messages, and all data. This action CANNOT be undone!')) {
                                return;
                            }
                            
                            if (!confirm('Last chance! Type DELETE in the next prompt to confirm.')) {
                                return;
                            }
                            
                            const confirmation = prompt('Type DELETE to confirm account deletion:');
                            if (confirmation !== 'DELETE') {
                                showToast('Account deletion cancelled', 'info');
                                return;
                            }
                            
                            try {
                                showToast('Deleting account...', 'info');
                                
                                // Helper function to delete documents in batches (Firestore limit is 500 per batch)
                                const deleteInBatches = async (docsToDelete) => {
                                    const batchSize = 500;
                                    for (let i = 0; i < docsToDelete.length; i += batchSize) {
                                        const batch = writeBatch(db);
                                        const batchDocs = docsToDelete.slice(i, i + batchSize);
                                        batchDocs.forEach(docRef => batch.delete(docRef));
                                        await batch.commit();
                                    }
                                };
                                
                                try {
                                    // Delete all chats where user is a participant
                                    const chatsQuery = query(
                                        collection(db, 'artifacts', getAppId(), 'public', 'data', 'chats'),
                                        where('participants', 'array-contains', user.uid)
                                    );
                                    const chatsSnapshot = await getDocs(chatsQuery);
                                    const docsToDelete = [];
                                    
                                    for (const chatDoc of chatsSnapshot.docs) {
                                        // Collect all messages in the chat
                                        const messagesQuery = collection(db, 'artifacts', getAppId(), 'public', 'data', 'chats', chatDoc.id, 'messages');
                                        const messagesSnapshot = await getDocs(messagesQuery);
                                        messagesSnapshot.docs.forEach(msgDoc => docsToDelete.push(msgDoc.ref));
                                        // Add chat document itself
                                        docsToDelete.push(chatDoc.ref);
                                    }
                                    
                                    if (docsToDelete.length > 0) {
                                        await deleteInBatches(docsToDelete);
                                    }
                                } catch (error) {
                                    console.error('Error deleting chats:', error);
                                    // Continue with other deletions
                                }
                                
                                try {
                                    // Delete all jobs associated with user (as client or tradie)
                                    const jobsQuery1 = query(
                                        collection(db, 'artifacts', getAppId(), 'public', 'data', 'jobs'),
                                        where('clientId', '==', user.uid)
                                    );
                                    const jobsSnapshot1 = await getDocs(jobsQuery1);
                                    
                                    const jobsQuery2 = query(
                                        collection(db, 'artifacts', getAppId(), 'public', 'data', 'jobs'),
                                        where('tradieId', '==', user.uid)
                                    );
                                    const jobsSnapshot2 = await getDocs(jobsQuery2);
                                    
                                    const jobDocs = [...jobsSnapshot1.docs, ...jobsSnapshot2.docs].map(doc => doc.ref);
                                    if (jobDocs.length > 0) {
                                        await deleteInBatches(jobDocs);
                                    }
                                } catch (error) {
                                    console.error('Error deleting jobs:', error);
                                    // Continue with other deletions
                                }
                                
                                try {
                                    // Delete all transactions
                                    const transactionsQuery = query(
                                        collection(db, 'artifacts', getAppId(), 'public', 'data', 'transactions'),
                                        where('userId', '==', user.uid)
                                    );
                                    const transactionsSnapshot = await getDocs(transactionsQuery);
                                    const txDocs = transactionsSnapshot.docs.map(doc => doc.ref);
                                    if (txDocs.length > 0) {
                                        await deleteInBatches(txDocs);
                                    }
                                } catch (error) {
                                    console.error('Error deleting transactions:', error);
                                    // Continue with other deletions
                                }
                                
                                try {
                                    // Delete blocked users records
                                    const blockedQuery1 = query(
                                        collection(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users'),
                                        where('blockedBy', '==', user.uid)
                                    );
                                    const blockedSnapshot1 = await getDocs(blockedQuery1);
                                    
                                    const blockedQuery2 = query(
                                        collection(db, 'artifacts', getAppId(), 'public', 'data', 'blocked_users'),
                                        where('blockedUser', '==', user.uid)
                                    );
                                    const blockedSnapshot2 = await getDocs(blockedQuery2);
                                    
                                    const blockedDocs = [...blockedSnapshot1.docs, ...blockedSnapshot2.docs].map(doc => doc.ref);
                                    if (blockedDocs.length > 0) {
                                        await deleteInBatches(blockedDocs);
                                    }
                                } catch (error) {
                                    console.error('Error deleting blocked users:', error);
                                    // Continue with other deletions
                                }
                                
                                // Delete profile document
                                await deleteDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid));
                                
                                // Delete Firebase Auth account
                                await deleteUser(user);
                                
                                showToast('Account deleted successfully', 'success');
                                // User will be automatically signed out and redirected to landing
                            } catch (error) {
                                console.error('Error deleting account:', error);
                                if (error.code === 'auth/requires-recent-login') {
                                    alert('For security, please log out and log back in before deleting your account.');
                                } else {
                                    showToast('Failed to delete account: ' + error.message, 'error');
                                }
                            }
                        }}
                    >
                        <Trash2 size={16} className="inline mr-2" />
                        Delete My Account
                    </Button>
                </div>

                {/* Save Button */}
                <Button onClick={handleSaveSettings} variant="secondary" className="w-full py-3">
                    Save Settings
                </Button>
            </div>

            {/* Blocked Users Modal */}
            {showBlockedUsers && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-end sm:items-center justify-center">
                    <div className="bg-white w-full sm:w-[400px] h-[70vh] sm:h-auto sm:max-h-[70vh] sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl relative flex flex-col">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="text-lg font-bold">Blocked Users</h3>
                            <button onClick={() => setShowBlockedUsers(false)}>
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {blockedUsers.length === 0 ? (
                                <div className="text-center py-10 text-slate-400">
                                    <Ban size={48} className="mx-auto mb-2 opacity-50" />
                                    <p>No blocked users</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {blockedUsers.map((blocked) => (
                                        <div key={blocked.id} className="bg-slate-50 rounded-lg p-3 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                                                    <User size={20} className="text-slate-400" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-sm">{blocked.blockedUserName || 'User'}</h4>
                                                    <p className="text-xs text-slate-500">
                                                        Blocked {blocked.blockedAt?.toDate ? blocked.blockedAt.toDate().toLocaleDateString() : 'recently'}
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                className="text-xs py-1 px-3"
                                                onClick={() => handleUnblockUser(blocked.id)}
                                            >
                                                Unblock
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Login History Modal */}
            {showLoginHistory && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-end sm:items-center justify-center">
                    <div className="bg-white w-full sm:w-[400px] h-[70vh] sm:h-auto sm:max-h-[70vh] sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl relative flex flex-col">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="text-lg font-bold">Active Sessions</h3>
                            <button onClick={() => setShowLoginHistory(false)}>
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <div className="space-y-2">
                                {activeSessions.map((session) => (
                                    <div key={session.id} className="bg-slate-50 rounded-lg p-3">
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1">
                                                <h4 className="font-bold text-sm flex items-center gap-2">
                                                    {session.device}
                                                    {session.isCurrent && (
                                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                                            Current
                                                        </span>
                                                    )}
                                                </h4>
                                                <p className="text-xs text-slate-500">{session.location}</p>
                                                <p className="text-xs text-slate-400">Last active: {session.lastActive}</p>
                                            </div>
                                            {!session.isCurrent && (
                                                <Button
                                                    variant="danger"
                                                    className="text-xs py-1 px-3"
                                                    onClick={() => handleLogoutSession(session.id)}
                                                >
                                                    Logout
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- PAYMENTS & CREDITS ---
const PaymentsCredits = ({ user, profile, onBack, showToast }) => {
    const [transactions, setTransactions] = useState([]);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);
    const [withdrawMethod, setWithdrawMethod] = useState('bank'); // 'bank' or 'crypto'
    const [withdrawAmount, setWithdrawAmount] = useState('');
    
    // Financial stats
    const onHoldBalance = profile?.finances?.onHoldBalance || 0;
    const availableBalance = profile?.finances?.availableBalance || 0;
    const totalEarnings = profile?.finances?.totalEarnings || 0;
    const totalCommissionPaid = profile?.finances?.totalCommissionPaid || 0;
    
    // Load transactions
    useEffect(() => {
        if (!user) return;
        
        const q = query(
            collection(db, 'artifacts', getAppId(), 'public', 'data', 'transactions'),
            where('tradieUid', '==', user.uid),
            orderBy('createdAt', 'desc'),
            limit(50)
        );
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const txs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setTransactions(txs);
        });
        
        return () => unsubscribe();
    }, [user]);
    
    const handleWithdraw = async () => {
        if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
            showToast("Please enter a valid amount", "error");
            return;
        }
        
        const amount = parseFloat(withdrawAmount);
        if (amount > availableBalance) {
            showToast("Insufficient available balance", "error");
            return;
        }
        
        try {
            // Create withdrawal transaction
            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'transactions'), {
                tradieUid: user.uid,
                type: 'withdrawal',
                amount: -amount,
                method: withdrawMethod,
                status: 'pending',
                createdAt: serverTimestamp()
            });
            
            // Update user's available balance
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), {
                'finances.availableBalance': increment(-amount)
            });
            
            showToast(`Withdrawal of £${amount.toFixed(2)} initiated via ${withdrawMethod === 'bank' ? 'Bank Transfer' : 'Crypto Wallet'}`, "success");
            setShowWithdrawModal(false);
            setWithdrawAmount('');
        } catch (error) {
            console.error("Error processing withdrawal:", error);
            showToast("Failed to process withdrawal", "error");
        }
    };
    
    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white p-4 sticky top-0 z-10 shadow-md">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                        <ChevronLeft size={24} />
                    </button>
                    <div className="flex items-center gap-2">
                        <DollarSign size={24} />
                        <h1 className="text-xl font-bold">Payments & Credits</h1>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Balance Cards */}
                <div className="grid grid-cols-2 gap-3">
                    {/* On Hold */}
                    <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-4 text-white shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <Clock size={18} />
                            <p className="text-xs font-medium opacity-90">On Hold</p>
                        </div>
                        <p className="text-2xl font-bold">£{onHoldBalance.toFixed(2)}</p>
                        <p className="text-xs opacity-75 mt-1">Pending completion</p>
                    </div>
                    
                    {/* Available */}
                    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                            <CheckCircle size={18} />
                            <p className="text-xs font-medium opacity-90">Available</p>
                        </div>
                        <p className="text-2xl font-bold">£{availableBalance.toFixed(2)}</p>
                        <p className="text-xs opacity-75 mt-1">Ready to withdraw</p>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-3">
                    {/* Total Earnings */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Earnings</p>
                        <p className="text-xl font-bold text-slate-900">£{totalEarnings.toFixed(2)}</p>
                    </div>
                    
                    {/* Commission Paid */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Commission (15%)</p>
                        <p className="text-xl font-bold text-slate-900">£{totalCommissionPaid.toFixed(2)}</p>
                    </div>
                </div>

                {/* Withdraw Button */}
                <button
                    onClick={() => setShowWithdrawModal(true)}
                    disabled={availableBalance <= 0}
                    className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all ${
                        availableBalance > 0
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 active:scale-95'
                            : 'bg-slate-300 cursor-not-allowed'
                    }`}
                >
                    <div className="flex items-center justify-center gap-2">
                        <DollarSign size={20} />
                        <span>Withdraw Funds</span>
                    </div>
                </button>

                {/* Transactions History */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100">
                    <div className="p-4 border-b border-slate-100">
                        <h2 className="font-bold text-slate-900">Transaction History</h2>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {transactions.length === 0 ? (
                            <div className="p-8 text-center text-slate-400">
                                <DollarSign size={48} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No transactions yet</p>
                            </div>
                        ) : (
                            transactions.map(tx => (
                                <div key={tx.id} className="p-4 flex items-center justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <p className="text-sm font-bold text-slate-900 capitalize">{tx.type}</p>
                                            {tx.status === 'pending' && (
                                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pending</span>
                                            )}
                                            {tx.status === 'completed' && (
                                                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Completed</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            {tx.jobTitle || (tx.method ? `Via ${tx.method === 'bank' ? 'Bank' : 'Crypto'}` : 'Payment')}
                                        </p>
                                        {tx.createdAt?.seconds && (
                                            <p className="text-xs text-slate-400 mt-1">
                                                {new Date(tx.createdAt.seconds * 1000).toLocaleDateString()}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-lg font-bold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {tx.amount >= 0 ? '+' : ''}£{Math.abs(tx.amount).toFixed(2)}
                                        </p>
                                        {tx.commission && (
                                            <p className="text-xs text-slate-500">-£{tx.commission.toFixed(2)} fee</p>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Withdraw Modal */}
            {showWithdrawModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-slate-900">Withdraw Funds</h2>
                            <button onClick={() => setShowWithdrawModal(false)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-4">
                            {/* Available Balance */}
                            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                                <p className="text-xs font-bold text-green-700 uppercase tracking-wider mb-1">Available Balance</p>
                                <p className="text-2xl font-bold text-green-900">£{availableBalance.toFixed(2)}</p>
                            </div>

                            {/* Withdrawal Method */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Withdrawal Method</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        onClick={() => setWithdrawMethod('bank')}
                                        className={`p-3 rounded-lg border-2 transition-all ${
                                            withdrawMethod === 'bank'
                                                ? 'border-orange-500 bg-orange-50'
                                                : 'border-slate-200 bg-white'
                                        }`}
                                    >
                                        <p className="text-sm font-bold">Bank Account</p>
                                        <p className="text-xs text-slate-500">1-3 days</p>
                                    </button>
                                    <button
                                        onClick={() => setWithdrawMethod('crypto')}
                                        className={`p-3 rounded-lg border-2 transition-all ${
                                            withdrawMethod === 'crypto'
                                                ? 'border-orange-500 bg-orange-50'
                                                : 'border-slate-200 bg-white'
                                        }`}
                                    >
                                        <p className="text-sm font-bold">Crypto Wallet</p>
                                        <p className="text-xs text-slate-500">Instant</p>
                                    </button>
                                </div>
                            </div>

                            {/* Amount */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Amount (£)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={availableBalance}
                                    value={withdrawAmount}
                                    onChange={(e) => setWithdrawAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-lg font-bold"
                                />
                                <button
                                    onClick={() => setWithdrawAmount(availableBalance.toString())}
                                    className="mt-2 text-xs text-orange-600 font-bold hover:text-orange-700"
                                >
                                    Withdraw All
                                </button>
                            </div>

                            {/* Info */}
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                                <div className="flex items-start gap-2">
                                    <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-blue-800">
                                        {withdrawMethod === 'bank'
                                            ? 'Bank transfers typically arrive within 1-3 business days.'
                                            : 'Crypto withdrawals are processed instantly to your wallet address.'}
                                    </p>
                                </div>
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={() => setShowWithdrawModal(false)}
                                    className="flex-1 py-3 px-4 rounded-lg border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleWithdraw}
                                    className="flex-1 py-3 px-4 rounded-lg bg-gradient-to-r from-green-500 to-green-600 text-white font-bold hover:from-green-600 hover:to-green-700 transition-all shadow-lg"
                                >
                                    Confirm Withdrawal
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- SAFETY CENTRE ---
const SafetyCentre = ({ user, onBack, showToast }) => {
    const [showReportModal, setShowReportModal] = useState(false);
    const [reportType, setReportType] = useState('user');
    const [reportDetails, setReportDetails] = useState('');
    const [trustedContacts, setTrustedContacts] = useState([]);
    const [showTrustedContactsModal, setShowTrustedContactsModal] = useState(false);
    const [newContactName, setNewContactName] = useState('');
    const [newContactPhone, setNewContactPhone] = useState('');

    // Load trusted contacts
    useEffect(() => {
        if (!user || !db) return;
        const unsub = onSnapshot(
            doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid),
            (docSnap) => {
                if (docSnap.exists()) {
                    setTrustedContacts(docSnap.data().trustedContacts || []);
                }
            }
        );
        return () => unsub();
    }, [user]);

    const handleSubmitReport = async () => {
        if (!reportDetails.trim()) {
            showToast("Please provide details", "error");
            return;
        }

        try {
            await addDoc(collection(db, 'artifacts', getAppId(), 'public', 'data', 'reports'), {
                reportedBy: user.uid,
                reportType,
                details: reportDetails,
                createdAt: serverTimestamp(),
                status: 'pending'
            });
            showToast("Report submitted. We'll review this promptly.", "success");
            setShowReportModal(false);
            setReportDetails('');
        } catch (error) {
            console.error("Error submitting report:", error);
            showToast("Failed to submit report", "error");
        }
    };

    const handleAddTrustedContact = async () => {
        if (!newContactName.trim() || !newContactPhone.trim()) {
            showToast("Please fill all fields", "error");
            return;
        }

        try {
            const newContact = {
                id: Date.now().toString(),
                name: newContactName,
                phone: newContactPhone,
                addedAt: new Date().toISOString()
            };
            
            await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), {
                trustedContacts: arrayUnion(newContact)
            });
            
            showToast("Trusted contact added", "success");
            setNewContactName('');
            setNewContactPhone('');
        } catch (error) {
            console.error("Error adding trusted contact:", error);
            showToast("Failed to add contact", "error");
        }
    };

    const handleQuickExit = () => {
        // Redirect to a neutral site without leaving browser history trail
        window.location.replace('https://www.google.com');
    };

    const SafetyCard = ({ icon: Icon, title, description, action, actionLabel, variant = 'default' }) => (
        <div className={`bg-white rounded-xl shadow-sm border p-4 ${
            variant === 'danger' ? 'border-red-200 bg-red-50' : 'border-slate-100'
        }`}>
            <div className="flex items-start gap-3 mb-3">
                <div className={`p-2 rounded-lg ${
                    variant === 'danger' ? 'bg-red-100' : 'bg-orange-50'
                }`}>
                    <Icon size={20} className={variant === 'danger' ? 'text-red-600' : 'text-orange-600'} />
                </div>
                <div className="flex-1">
                    <h4 className="font-bold text-sm text-slate-900 mb-1">{title}</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
                </div>
            </div>
            {action && (
                <Button
                    variant={variant === 'danger' ? 'danger' : 'outline'}
                    className="w-full text-xs py-2"
                    onClick={action}
                >
                    {actionLabel}
                </Button>
            )}
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Header */}
            <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white sticky top-0 z-40">
                <div className="p-4 flex items-center gap-3">
                    <button onClick={onBack}><ArrowRight className="rotate-180" size={20} /></button>
                    <div className="flex-1">
                        <h1 className="text-xl font-bold">Safety Centre</h1>
                        <p className="text-xs opacity-90">Your safety is our priority</p>
                    </div>
                    <Shield size={24} />
                </div>
            </div>

            {/* Quick Exit Button */}
            <div className="p-4 bg-red-50 border-b border-red-100">
                <Button
                    variant="danger"
                    className="w-full py-3 flex items-center justify-center gap-2"
                    onClick={handleQuickExit}
                >
                    <AlertTriangle size={18} />
                    Quick Exit / Panic Button
                </Button>
                <p className="text-xs text-red-700 text-center mt-2">
                    Instantly redirects to Google for your safety
                </p>
            </div>

            <div className="p-4 space-y-4">
                {/* Critical Actions */}
                <div className="space-y-3">
                    <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Critical Actions</h3>
                    
                    <SafetyCard
                        icon={Flag}
                        title="Report User"
                        description="Report harassment, hate speech, or inappropriate behavior"
                        action={() => { setReportType('user'); setShowReportModal(true); }}
                        actionLabel="Report a User"
                        variant="danger"
                    />
                    
                    <SafetyCard
                        icon={AlertCircle}
                        title="Report Safety Concern"
                        description="Report a job-related safety issue or scam attempt"
                        action={() => { setReportType('safety'); setShowReportModal(true); }}
                        actionLabel="Report Concern"
                        variant="danger"
                    />
                    
                    <SafetyCard
                        icon={Phone}
                        title="Emergency Support"
                        description="Get immediate help from local emergency services"
                        action={() => window.location.href = 'tel:999'}
                        actionLabel="Call Emergency Services"
                        variant="danger"
                    />
                </div>

                {/* Educational Content */}
                <div className="space-y-3 mt-6">
                    <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Safety Guides</h3>
                    
                    <SafetyCard
                        icon={ShieldCheck}
                        title="Verification Process"
                        description="Learn how our verification system protects you and ensures tradies are qualified"
                        action={() => showToast("Verification guide opened", "info")}
                        actionLabel="Learn More"
                    />
                    
                    <SafetyCard
                        icon={Briefcase}
                        title="Safe Hiring Guidelines"
                        description="Best practices for hiring tradies, including deposit warnings and contract tips"
                        action={() => showToast("Safe hiring guide opened", "info")}
                        actionLabel="Read Guidelines"
                    />
                    
                    <SafetyCard
                        icon={HardHat}
                        title="In-Home Conduct"
                        description="What to expect when tradies work in your home and how to stay safe"
                        action={() => showToast("Conduct guide opened", "info")}
                        actionLabel="View Guide"
                    />
                    
                    <SafetyCard
                        icon={Lock}
                        title="Privacy Protection"
                        description="How we protect against outing, doxxing, and unwanted exposure"
                        action={() => showToast("Privacy guide opened", "info")}
                        actionLabel="Learn More"
                    />
                    
                    <SafetyCard
                        icon={Ban}
                        title="Harassment Policy"
                        description="Our zero-tolerance policy for hate speech and harassment"
                        action={() => showToast("Policy opened", "info")}
                        actionLabel="Read Policy"
                    />
                    
                    <SafetyCard
                        icon={Heart}
                        title="Consent Guidelines"
                        description="Understanding consent in professional and personal interactions"
                        action={() => showToast("Consent guidelines opened", "info")}
                        actionLabel="View Guidelines"
                    />
                    
                    <SafetyCard
                        icon={AlertTriangle}
                        title="Scam Prevention"
                        description="How to spot and avoid scams, including deposit fraud and fake profiles"
                        action={() => showToast("Scam prevention guide opened", "info")}
                        actionLabel="Stay Safe"
                    />
                </div>

                {/* Advanced Safety Features */}
                <div className="space-y-3 mt-6">
                    <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Advanced Safety</h3>
                    
                    <SafetyCard
                        icon={Users}
                        title="Trusted Contacts"
                        description="Add trusted people who can be notified about your job bookings"
                        action={() => setShowTrustedContactsModal(true)}
                        actionLabel="Manage Contacts"
                    />
                </div>

                {/* Resources */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-xl p-6 mt-6">
                    <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                        <Info size={20} />
                        Need Help?
                    </h3>
                    <p className="text-sm text-slate-300 mb-4">
                        If you're experiencing issues or need support, we're here to help 24/7.
                    </p>
                    <div className="space-y-2">
                        <a
                            href="https://www.galop.org.uk/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-3 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                        >
                            <span className="text-sm font-medium">Galop LGBT+ Hate Crime Support</span>
                            <ExternalLink size={16} />
                        </a>
                        <a
                            href="https://www.switchboard.lgbt/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between p-3 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                        >
                            <span className="text-sm font-medium">Switchboard LGBT+ Helpline</span>
                            <ExternalLink size={16} />
                        </a>
                    </div>
                </div>
            </div>

            {/* Report Modal */}
            {showReportModal && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-end sm:items-center justify-center p-4">
                    <div className="bg-white w-full sm:w-[400px] sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-red-50">
                            <h3 className="text-lg font-bold text-red-900">Submit Report</h3>
                            <button onClick={() => setShowReportModal(false)}>
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="p-4">
                            <p className="text-sm text-slate-600 mb-4">
                                Your report will be reviewed by our safety team. All reports are taken seriously and handled confidentially.
                            </p>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-2">Report Type</label>
                                <select
                                    value={reportType}
                                    onChange={(e) => setReportType(e.target.value)}
                                    className="w-full p-3 border border-slate-300 rounded-lg"
                                >
                                    <option value="user">User Behavior</option>
                                    <option value="safety">Safety Concern</option>
                                    <option value="scam">Scam/Fraud</option>
                                    <option value="harassment">Harassment</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-2">Details</label>
                                <textarea
                                    value={reportDetails}
                                    onChange={(e) => setReportDetails(e.target.value)}
                                    placeholder="Please provide as much detail as possible..."
                                    rows={4}
                                    className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:outline-none"
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button variant="ghost" className="flex-1" onClick={() => setShowReportModal(false)}>
                                    Cancel
                                </Button>
                                <Button variant="danger" className="flex-1" onClick={handleSubmitReport}>
                                    Submit Report
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Trusted Contacts Modal */}
            {showTrustedContactsModal && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-end sm:items-center justify-center p-4">
                    <div className="bg-white w-full sm:w-[400px] h-[80vh] sm:h-auto sm:max-h-[80vh] sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl flex flex-col">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="text-lg font-bold">Trusted Contacts</h3>
                            <button onClick={() => setShowTrustedContactsModal(false)}>
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <p className="text-sm text-slate-600 mb-4">
                                Add trusted contacts who can be notified about your job bookings for added safety.
                            </p>
                            
                            {/* Add New Contact Form */}
                            <div className="bg-slate-50 rounded-lg p-4 mb-4">
                                <h4 className="font-bold text-sm mb-3">Add New Contact</h4>
                                <Input
                                    label="Name"
                                    placeholder="e.g., Sarah Smith"
                                    value={newContactName}
                                    onChange={(e) => setNewContactName(e.target.value)}
                                />
                                <Input
                                    label="Phone Number"
                                    placeholder="e.g., 07700 900000"
                                    value={newContactPhone}
                                    onChange={(e) => setNewContactPhone(e.target.value)}
                                />
                                <Button
                                    variant="secondary"
                                    className="w-full text-sm"
                                    onClick={handleAddTrustedContact}
                                >
                                    Add Contact
                                </Button>
                            </div>

                            {/* Existing Contacts List */}
                            {trustedContacts.length > 0 && (
                                <div>
                                    <h4 className="font-bold text-sm mb-2">Your Contacts</h4>
                                    <div className="space-y-2">
                                        {trustedContacts.map((contact) => (
                                            <div key={contact.id} className="bg-white border border-slate-200 rounded-lg p-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <h5 className="font-bold text-sm">{contact.name}</h5>
                                                        <p className="text-xs text-slate-500">{contact.phone}</p>
                                                    </div>
                                                    <Phone size={16} className="text-orange-500" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- WORK CALENDAR COMPONENT ---
const WorkCalendar = ({ user, profile, onBack, showToast }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [unavailability, setUnavailability] = useState({});
    const [selectedDate, setSelectedDate] = useState(null);

    // Helper to get profile document reference
    const getProfileDocRef = () => doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid);

    // Load unavailability data from Firebase
    useEffect(() => {
        if (!user || !db) return;
        const unsub = onSnapshot(
            getProfileDocRef(),
            (docSnap) => {
                if (docSnap.exists()) {
                    setUnavailability(docSnap.data().workCalendar || {});
                } else {
                    setUnavailability({});
                }
            }
        );
        return () => unsub();
    }, [user]);

    // Calendar helper functions
    const getDaysInMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();
        
        return { daysInMonth, startingDayOfWeek, year, month };
    };

    const navigateMonth = (direction) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(currentDate.getMonth() + direction);
        setCurrentDate(newDate);
    };

    const toggleTimeSlot = async (dateKey, timeSlot) => {
        const newUnavailability = { ...unavailability };
        
        // Initialize date if it doesn't exist (use object format for new entries)
        if (!newUnavailability[dateKey]) {
            newUnavailability[dateKey] = {};
        }
        
        // Convert old array format to new object format if needed
        if (Array.isArray(newUnavailability[dateKey])) {
            const oldSlots = newUnavailability[dateKey];
            newUnavailability[dateKey] = {};
            oldSlots.forEach(slot => {
                newUnavailability[dateKey][slot] = { reason: 'manual' };
            });
        }
        
        const dateSlots = newUnavailability[dateKey];
        
        // Toggle the slot (only allow toggling manual slots, not job slots)
        if (dateSlots[timeSlot]) {
            // Only allow removing manual unavailability, not job-based
            if (dateSlots[timeSlot].reason === 'manual') {
                delete dateSlots[timeSlot];
            } else {
                showToast("Cannot remove job-booked time slots", "error");
                return;
            }
        } else {
            dateSlots[timeSlot] = { reason: 'manual' };
        }
        
        // Clean up empty date entries
        if (Object.keys(dateSlots).length === 0) {
            delete newUnavailability[dateKey];
        }
        
        try {
            // If workCalendar is now empty, remove the field entirely from Firebase
            if (Object.keys(newUnavailability).length === 0) {
                await updateDoc(getProfileDocRef(), {
                    workCalendar: deleteField()
                });
            } else {
                await updateDoc(getProfileDocRef(), {
                    workCalendar: newUnavailability
                });
            }
            setUnavailability(newUnavailability);
            showToast("Availability updated", "success");
        } catch (error) {
            console.error("Error updating availability:", error);
            showToast("Failed to update availability", "error");
        }
    };

    const blockEntireDay = async (dateKey) => {
        const newUnavailability = { ...unavailability };
        
        // Convert to object format if needed
        if (Array.isArray(newUnavailability[dateKey])) {
            const oldSlots = newUnavailability[dateKey];
            newUnavailability[dateKey] = {};
            oldSlots.forEach(slot => {
                newUnavailability[dateKey][slot] = { reason: 'manual' };
            });
        } else if (!newUnavailability[dateKey]) {
            newUnavailability[dateKey] = {};
        }
        
        // Block all time slots (preserve job slots)
        ['morning', 'afternoon', 'evening'].forEach(slot => {
            if (!newUnavailability[dateKey][slot] || newUnavailability[dateKey][slot].reason !== 'job') {
                newUnavailability[dateKey][slot] = { reason: 'manual' };
            }
        });
        
        try {
            await updateDoc(getProfileDocRef(), {
                workCalendar: newUnavailability
            });
            setUnavailability(newUnavailability);
            showToast("Entire day blocked", "success");
        } catch (error) {
            console.error("Error blocking day:", error);
            showToast("Failed to block day", "error");
        }
    };

    const blockEntireWeek = async (startDateKey) => {
        const newUnavailability = { ...unavailability };
        const startDate = new Date(startDateKey + 'T00:00:00');
        
        // Block 7 days starting from the selected date
        for (let i = 0; i < 7; i++) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            const dateKey = formatDateKey(date);
            
            // Convert to object format if needed
            if (Array.isArray(newUnavailability[dateKey])) {
                const oldSlots = newUnavailability[dateKey];
                newUnavailability[dateKey] = {};
                oldSlots.forEach(slot => {
                    newUnavailability[dateKey][slot] = { reason: 'manual' };
                });
            } else if (!newUnavailability[dateKey]) {
                newUnavailability[dateKey] = {};
            }
            
            // Block all time slots (preserve job slots)
            ['morning', 'afternoon', 'evening'].forEach(slot => {
                if (!newUnavailability[dateKey][slot] || newUnavailability[dateKey][slot].reason !== 'job') {
                    newUnavailability[dateKey][slot] = { reason: 'manual' };
                }
            });
        }
        
        try {
            await updateDoc(getProfileDocRef(), {
                workCalendar: newUnavailability
            });
            setUnavailability(newUnavailability);
            showToast("Entire week blocked", "success");
        } catch (error) {
            console.error("Error blocking week:", error);
            showToast("Failed to block week", "error");
        }
    };

    const blockEntireMonth = async (dateKey) => {
        const newUnavailability = { ...unavailability };
        const [yearStr, monthStr] = dateKey.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10) - 1;
        
        // Get the number of days in the month
        const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
        
        // Block all days in the month
        for (let day = 1; day <= lastDayOfMonth; day++) {
            const date = new Date(year, month, day);
            const key = formatDateKey(date);
            
            // Convert to object format if needed
            if (Array.isArray(newUnavailability[key])) {
                const oldSlots = newUnavailability[key];
                newUnavailability[key] = {};
                oldSlots.forEach(slot => {
                    newUnavailability[key][slot] = { reason: 'manual' };
                });
            } else if (!newUnavailability[key]) {
                newUnavailability[key] = {};
            }
            
            // Block all time slots (preserve job slots)
            ['morning', 'afternoon', 'evening'].forEach(slot => {
                if (!newUnavailability[key][slot] || newUnavailability[key][slot].reason !== 'job') {
                    newUnavailability[key][slot] = { reason: 'manual' };
                }
            });
        }
        
        try {
            await updateDoc(getProfileDocRef(), {
                workCalendar: newUnavailability
            });
            setUnavailability(newUnavailability);
            showToast("Entire month blocked", "success");
        } catch (error) {
            console.error("Error blocking month:", error);
            showToast("Failed to block month", "error");
        }
    };

    // Helper function to update work calendar and handle empty state
    const updateWorkCalendar = async (newUnavailability, successMessage) => {
        try {
            if (Object.keys(newUnavailability).length === 0) {
                await updateDoc(getProfileDocRef(), {
                    workCalendar: deleteField()
                });
            } else {
                await updateDoc(getProfileDocRef(), {
                    workCalendar: newUnavailability
                });
            }
            setUnavailability(newUnavailability);
            showToast(successMessage, "success");
        } catch (error) {
            console.error("Error updating work calendar:", error);
            showToast("Failed to update calendar", "error");
        }
    };

    const clearEntireDay = async (dateKey) => {
        const newUnavailability = { ...unavailability };
        const dateSlots = newUnavailability[dateKey];
        
        if (!dateSlots) {
            showToast("No unavailability to clear", "error");
            return;
        }
        
        // If it's old array format, just delete it (no job protection needed for old data)
        if (Array.isArray(dateSlots)) {
            delete newUnavailability[dateKey];
            await updateWorkCalendar(newUnavailability, "Day cleared");
            return;
        }
        
        // New object format - only remove manual slots, keep job slots
        const jobSlots = {};
        Object.keys(dateSlots).forEach(slot => {
            if (dateSlots[slot]?.reason === 'job') {
                jobSlots[slot] = dateSlots[slot];
            }
        });
        
        if (Object.keys(jobSlots).length > 0) {
            newUnavailability[dateKey] = jobSlots;
            await updateWorkCalendar(newUnavailability, "Day cleared (job-booked slots preserved)");
        } else {
            delete newUnavailability[dateKey];
            await updateWorkCalendar(newUnavailability, "Day cleared");
        }
    };

    const clearEntireWeek = async (startDateKey) => {
        const newUnavailability = { ...unavailability };
        const [year, month, day] = startDateKey.split('-').map(Number);
        const startDate = new Date(year, month - 1, day);
        
        let hasJobSlots = false;
        
        // Clear 7 days starting from the selected date
        for (let i = 0; i < 7; i++) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            const dateKey = formatDateKey(date);
            const dateSlots = newUnavailability[dateKey];
            
            if (!dateSlots) continue;
            
            // If it's old array format, just delete it
            if (Array.isArray(dateSlots)) {
                delete newUnavailability[dateKey];
            } else {
                // New object format - only remove manual slots, keep job slots
                const jobSlots = {};
                Object.keys(dateSlots).forEach(slot => {
                    if (dateSlots[slot]?.reason === 'job') {
                        jobSlots[slot] = dateSlots[slot];
                        hasJobSlots = true;
                    }
                });
                
                if (Object.keys(jobSlots).length > 0) {
                    newUnavailability[dateKey] = jobSlots;
                } else {
                    delete newUnavailability[dateKey];
                }
            }
        }
        
        const message = hasJobSlots ? "Week cleared (job-booked slots preserved)" : "Week cleared";
        await updateWorkCalendar(newUnavailability, message);
    };

    const clearEntireMonth = async (dateKey) => {
        const newUnavailability = { ...unavailability };
        const [year, month] = dateKey.split('-').map(Number);
        
        // Get the number of days in the month
        const lastDayOfMonth = new Date(year, month, 0).getDate();
        
        let hasJobSlots = false;
        
        // Clear all days in the month
        for (let day = 1; day <= lastDayOfMonth; day++) {
            const date = new Date(year, month - 1, day);
            const key = formatDateKey(date);
            const dateSlots = newUnavailability[key];
            
            if (!dateSlots) continue;
            
            // If it's old array format, just delete it
            if (Array.isArray(dateSlots)) {
                delete newUnavailability[key];
            } else {
                // New object format - only remove manual slots, keep job slots
                const jobSlots = {};
                Object.keys(dateSlots).forEach(slot => {
                    if (dateSlots[slot]?.reason === 'job') {
                        jobSlots[slot] = dateSlots[slot];
                        hasJobSlots = true;
                    }
                });
                
                if (Object.keys(jobSlots).length > 0) {
                    newUnavailability[key] = jobSlots;
                } else {
                    delete newUnavailability[key];
                }
            }
        }
        
        const message = hasJobSlots ? "Month cleared (job-booked slots preserved)" : "Month cleared";
        await updateWorkCalendar(newUnavailability, message);
    };

    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentDate);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const today = new Date();
    const todayKey = formatDateKey(today);
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return (
        <div className="min-h-screen bg-slate-50 pb-20">
            {/* Header */}
            <div className="bg-orange-500 text-white sticky top-0 z-40">
                <div className="p-4 flex items-center gap-3">
                    <button onClick={onBack}><ArrowRight className="rotate-180" size={20} /></button>
                    <div className="flex-1">
                        <h1 className="text-xl font-bold">Work Calendar</h1>
                        <p className="text-xs opacity-90">Manage your availability</p>
                    </div>
                    <Calendar size={24} />
                </div>
            </div>

            <div className="p-4">
                {/* Info Banner */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                    <div className="flex items-start gap-3">
                        <Info size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h3 className="font-bold text-sm text-blue-900 mb-1">How it works</h3>
                            <p className="text-xs text-blue-800 leading-relaxed">
                                Mark dates and times when you're <strong>not available</strong> for hire. 
                                Your profile will be hidden from the Hire tab during those times.
                            </p>
                        </div>
                    </div>
                </div>

                {/* QUICK OPTIONS - Always visible, placed ABOVE calendar */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
                    <h4 className="font-bold text-xs text-slate-500 uppercase tracking-wider mb-3">Quick Options</h4>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <Button
                            variant="outline"
                            className="text-xs py-2 px-2"
                            onClick={() => selectedDate ? blockEntireDay(selectedDate) : showToast("Select a date first", "error")}
                        >
                            Block Day
                        </Button>
                        <Button
                            variant="outline"
                            className="text-xs py-2 px-2"
                            onClick={() => selectedDate ? blockEntireWeek(selectedDate) : showToast("Select a date first", "error")}
                        >
                            Block Week
                        </Button>
                        <Button
                            variant="outline"
                            className="text-xs py-2 px-2"
                            onClick={() => selectedDate ? blockEntireMonth(selectedDate) : showToast("Select a date first", "error")}
                        >
                            Block Month
                        </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <Button
                            variant="ghost"
                            className="text-xs py-2 px-2"
                            onClick={() => selectedDate ? clearEntireDay(selectedDate) : showToast("Select a date first", "error")}
                        >
                            Clear Day
                        </Button>
                        <Button
                            variant="ghost"
                            className="text-xs py-2 px-2"
                            onClick={() => selectedDate ? clearEntireWeek(selectedDate) : showToast("Select a date first", "error")}
                        >
                            Clear Week
                        </Button>
                        <Button
                            variant="ghost"
                            className="text-xs py-2 px-2"
                            onClick={() => selectedDate ? clearEntireMonth(selectedDate) : showToast("Select a date first", "error")}
                        >
                            Clear Month
                        </Button>
                    </div>
                </div>

                {/* Calendar Navigation */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
                    <div className="flex items-center justify-between mb-4">
                        <button
                            onClick={() => navigateMonth(-1)}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <ChevronLeft size={24} className="text-slate-600" />
                        </button>
                        <h2 className="text-lg font-bold text-slate-900">
                            {monthNames[month]} {year}
                        </h2>
                        <button
                            onClick={() => navigateMonth(1)}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            <ChevronRightIcon size={24} className="text-slate-600" />
                        </button>
                    </div>

                    {/* Day names */}
                    <div className="grid grid-cols-7 gap-1 mb-2">
                        {dayNames.map(day => (
                            <div key={day} className="text-center text-xs font-bold text-slate-500 py-1">
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Calendar grid */}
                    <div className="grid grid-cols-7 gap-1">
                        {/* Empty cells for days before month starts */}
                        {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                            <div key={`empty-${i}`} className="aspect-square" />
                        ))}
                        
                        {/* Days of the month */}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const day = i + 1;
                            const date = new Date(year, month, day);
                            const dateKey = formatDateKey(date);
                            const isPast = date < todayDateOnly;
                            const isToday = dateKey === todayKey;
                            const isSelected = selectedDate === dateKey;
                            
                            // Check for unavailability (support both array and object formats)
                            const dateSlots = unavailability[dateKey];
                            let hasUnavailability = false;
                            if (dateSlots) {
                                if (Array.isArray(dateSlots)) {
                                    hasUnavailability = dateSlots.length > 0;
                                } else {
                                    hasUnavailability = Object.keys(dateSlots).length > 0;
                                }
                            }
                            
                            return (
                                <button
                                    key={day}
                                    onClick={() => !isPast && setSelectedDate(dateKey)}
                                    disabled={isPast}
                                    className={`aspect-square rounded-lg flex items-center justify-center text-sm font-bold transition-all ${
                                        isPast
                                            ? 'text-slate-300 cursor-not-allowed'
                                            : isSelected
                                            ? 'bg-orange-500 text-white shadow-md'
                                            : isToday
                                            ? 'bg-blue-100 text-blue-900 border-2 border-blue-500'
                                            : hasUnavailability
                                            ? 'bg-red-100 text-red-900 border border-red-300'
                                            : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
                                    }`}
                                >
                                    {day}
                                </button>
                            );
                        })}
                    </div>

                    {/* Legend */}
                    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-3 text-xs">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-blue-100 border-2 border-blue-500" />
                            <span className="text-slate-600">Today</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-red-100 border border-red-300" />
                            <span className="text-slate-600">Unavailable</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-slate-50 border border-slate-200" />
                            <span className="text-slate-600">Available</span>
                        </div>
                    </div>
                </div>

                {/* Time Slot Selection */}
                {selectedDate && (() => {
                    // Parse selectedDate string safely (YYYY-MM-DD format)
                    const [yearStr, monthStr, dayStr] = selectedDate.split('-');
                    const selectedDateObj = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10));
                    
                    return (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 animate-in fade-in slide-in-from-bottom duration-300">
                        <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                            <Clock size={18} className="text-orange-500" />
                            {selectedDateObj.toLocaleDateString('en-GB', { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                            })}
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">
                            Select time slots when you are <strong>NOT available</strong>
                        </p>

                        <div className="space-y-3">
                            {/* Morning */}
                            {(() => {
                                const dateSlots = unavailability[selectedDate];
                                let isUnavailable = false;
                                let isJob = false;
                                
                                if (dateSlots) {
                                    if (Array.isArray(dateSlots)) {
                                        isUnavailable = dateSlots.includes('morning');
                                    } else {
                                        isUnavailable = !!dateSlots['morning'];
                                        isJob = dateSlots['morning']?.reason === 'job';
                                    }
                                }
                                
                                return (
                                    <button
                                        onClick={() => toggleTimeSlot(selectedDate, 'morning')}
                                        className={`w-full p-4 rounded-lg border-2 transition-all flex items-center justify-between ${
                                            isUnavailable
                                                ? isJob
                                                    ? 'bg-blue-50 border-blue-500 text-blue-900'
                                                    : 'bg-red-50 border-red-500 text-red-900'
                                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-orange-500'
                                        }`}
                                    >
                                        <div className="text-left">
                                            <div className="font-bold text-sm">Morning</div>
                                            <div className="text-xs opacity-75">
                                                8:00 AM - 12:00 PM
                                                {isJob && <span className="ml-2 font-bold">(Job Booked)</span>}
                                            </div>
                                        </div>
                                        {isUnavailable && (
                                            <Ban size={20} className={isJob ? 'text-blue-600' : 'text-red-600'} />
                                        )}
                                    </button>
                                );
                            })()}

                            {/* Afternoon */}
                            {(() => {
                                const dateSlots = unavailability[selectedDate];
                                let isUnavailable = false;
                                let isJob = false;
                                
                                if (dateSlots) {
                                    if (Array.isArray(dateSlots)) {
                                        isUnavailable = dateSlots.includes('afternoon');
                                    } else {
                                        isUnavailable = !!dateSlots['afternoon'];
                                        isJob = dateSlots['afternoon']?.reason === 'job';
                                    }
                                }
                                
                                return (
                                    <button
                                        onClick={() => toggleTimeSlot(selectedDate, 'afternoon')}
                                        className={`w-full p-4 rounded-lg border-2 transition-all flex items-center justify-between ${
                                            isUnavailable
                                                ? isJob
                                                    ? 'bg-blue-50 border-blue-500 text-blue-900'
                                                    : 'bg-red-50 border-red-500 text-red-900'
                                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-orange-500'
                                        }`}
                                    >
                                        <div className="text-left">
                                            <div className="font-bold text-sm">Afternoon</div>
                                            <div className="text-xs opacity-75">
                                                12:00 PM - 8:00 PM
                                                {isJob && <span className="ml-2 font-bold">(Job Booked)</span>}
                                            </div>
                                        </div>
                                        {isUnavailable && (
                                            <Ban size={20} className={isJob ? 'text-blue-600' : 'text-red-600'} />
                                        )}
                                    </button>
                                );
                            })()}

                            {/* Evening */}
                            {(() => {
                                const dateSlots = unavailability[selectedDate];
                                let isUnavailable = false;
                                let isJob = false;
                                
                                if (dateSlots) {
                                    if (Array.isArray(dateSlots)) {
                                        isUnavailable = dateSlots.includes('evening');
                                    } else {
                                        isUnavailable = !!dateSlots['evening'];
                                        isJob = dateSlots['evening']?.reason === 'job';
                                    }
                                }
                                
                                return (
                                    <button
                                        onClick={() => toggleTimeSlot(selectedDate, 'evening')}
                                        className={`w-full p-4 rounded-lg border-2 transition-all flex items-center justify-between ${
                                            isUnavailable
                                                ? isJob
                                                    ? 'bg-blue-50 border-blue-500 text-blue-900'
                                                    : 'bg-red-50 border-red-500 text-red-900'
                                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-orange-500'
                                        }`}
                                    >
                                        <div className="text-left">
                                            <div className="font-bold text-sm">Evening</div>
                                            <div className="text-xs opacity-75">
                                                8:00 PM - 11:00 PM
                                                {isJob && <span className="ml-2 font-bold">(Job Booked)</span>}
                                            </div>
                                        </div>
                                        {isUnavailable && (
                                            <Ban size={20} className={isJob ? 'text-blue-600' : 'text-red-600'} />
                                        )}
                                    </button>
                                );
                            })()}
                        </div>
                    </div>
                    );
                })()}
            </div>
        </div>
    );
};

const AdminPanel = ({ user, onBack, showToast }) => {
    const handleVerifySelf = async () => { await updateDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', user.uid), { verified: true }); showToast("Verified!", "success"); onBack(); };
    const handleSeedData = async () => {
        // Updated mock data structure with varied GPS locations for distance testing
        // Centered around London (51.5074, -0.1278) with varying distances
        const dummyTradies = [
            { uid: 'mock_t1', name: 'Jake Builder', age: 29, role: 'tradie', trade: 'Carpenter', verified: true, location: 'Central London', latitude: 51.5074, longitude: -0.1278, bio: 'Reliable chippy. Quality work.', rate: 45, reviews: 12, rating: 4.8, sexuality: 'Gay', primaryPhoto: null },
            { uid: 'mock_t2', name: 'Mike Spark', age: 34, role: 'tradie', trade: 'Electrician', verified: true, location: 'East London', latitude: 51.5155, longitude: -0.0922, bio: 'Fully qualified sparky. 15 years experience.', rate: 60, reviews: 24, rating: 5.0, sexuality: 'Bi', primaryPhoto: null },
            { uid: 'mock_t3', name: 'Tom Scapes', age: 25, role: 'tradie', trade: 'Landscaper', verified: false, location: 'West London', latitude: 51.5074, longitude: -0.2278, bio: 'Hard grafter. Love outdoor work.', rate: 35, reviews: 3, rating: 4.5, sexuality: 'Gay', primaryPhoto: null },
            { uid: 'mock_t4', name: 'Dave Plumb', age: 42, role: 'tradie', trade: 'Plumber', verified: true, location: 'North London', latitude: 51.5574, longitude: -0.1278, bio: 'No job too small. Emergency callouts.', rate: 55, reviews: 41, rating: 4.9, sexuality: 'Gay', primaryPhoto: null },
            { uid: 'mock_t5', name: 'Sam Painter', age: 31, role: 'tradie', trade: 'Painter & Decorator', verified: true, location: 'South London', latitude: 51.4574, longitude: -0.1278, bio: 'Interior & exterior. Professional finish.', rate: 40, reviews: 18, rating: 4.7, sexuality: 'Curious', primaryPhoto: null },
            { uid: 'mock_c1', name: 'Chris', age: 28, role: 'admirer', location: 'Shoreditch', latitude: 51.5256, longitude: -0.0789, bio: 'Looking for a reliable electrician and maybe more...', sexuality: 'Gay', primaryPhoto: null },
            { uid: 'mock_c2', name: 'Alex', age: 35, role: 'admirer', location: 'Camden', latitude: 51.5390, longitude: -0.1426, bio: 'Need some work done on my flat. Love a man in uniform.', sexuality: 'Bi', primaryPhoto: null },
        ];
        for (const t of dummyTradies) { 
            await setDoc(doc(db, 'artifacts', getAppId(), 'public', 'data', 'profiles', t.uid), { 
                ...t, 
                joinedAt: serverTimestamp(),
                locationUpdatedAt: serverTimestamp()
            }); 
        }
        showToast("Test users created with GPS data!", "success");
    };

    return (
        <div className="h-screen bg-slate-50 p-4">
            <div className="flex items-center gap-2 mb-6"><button onClick={onBack}><ArrowRight className="rotate-180" /></button><h1 className="font-bold text-xl">Admin Dashboard</h1></div>
            <div className="bg-white rounded-xl shadow p-4 mb-4">
                 <div className="space-y-3">
                     <Button onClick={handleVerifySelf} variant="secondary" className="w-full gap-2"><CheckCircle size={18} /> Verify My Profile for test</Button>
                     <Button onClick={handleSeedData} variant="primary" className="w-full gap-2"><Database size={18} /> Generate Test Users for test</Button>
                 </div>
            </div>
        </div>
    );
};