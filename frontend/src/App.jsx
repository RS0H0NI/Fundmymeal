import React, { useState, useEffect, useRef } from 'react';
import { 
  HeartHandshake, Fingerprint, MapPin, Utensils, 
  CheckCircle2, XCircle, TrendingUp, ShieldCheck, 
  LayoutDashboard, UserPlus, CreditCard, ChevronRight, Sparkles
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, updateDoc, addDoc } from 'firebase/firestore';

// --- Simulated Backend Data ---
const INITIAL_RESTAURANTS = [
  { id: 1, name: "Campus Deli", lat: 43.0731, lng: -89.4012, funds: 150, mealsServed: 12 },
  { id: 2, name: "Green Bowl Salad Co.", lat: 43.0742, lng: -89.3980, funds: 45, mealsServed: 34 },
  { id: 3, name: "Student Pizza Kitchen", lat: 43.0725, lng: -89.4030, funds: 300, mealsServed: 8 }
];

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

export default function App() {
  const [activeTab, setActiveTab] = useState('recipient'); // 'recipient', 'donor', 'dashboard'
  
  // App State (Synced with Firebase)
  const [restaurants, setRestaurants] = useState([]);
  const [enrolledUsers, setEnrolledUsers] = useState([]); 
  const [transactions, setTransactions] = useState([]); 
  
  // UI State
  const [currentUser, setCurrentUser] = useState(null);
  const [user, setUser] = useState(null); // Firebase auth user
  const [biometricModal, setBiometricModal] = useState({ isOpen: false, mode: 'enroll', restaurantId: null });
  const [scanStatus, setScanStatus] = useState('idle'); // idle, scanning, success, error
  const [donationSuccess, setDonationSuccess] = useState('');

  // Get today's date string for limiting logic
  const getTodayStr = () => new Date().toISOString().split('T')[0];

  // --- Firebase Setup & Sync ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const restsRef = collection(db, 'artifacts', appId, 'public', 'data', 'restaurants');
    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'users');
    const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');

    const unsubRests = onSnapshot(restsRef, (snap) => {
      const data = snap.docs.map(d => ({...d.data(), id: parseInt(d.id)}));
      if (data.length === 0) {
        // Seed DB on first load
        INITIAL_RESTAURANTS.forEach(async r => {
          await setDoc(doc(restsRef, r.id.toString()), r);
        });
      } else {
        setRestaurants(data.sort((a,b) => a.id - b.id));
      }
    }, console.error);

    const unsubUsers = onSnapshot(usersRef, (snap) => {
      setEnrolledUsers(snap.docs.map(d => d.data()));
    }, console.error);

    const unsubTx = onSnapshot(txRef, (snap) => {
      const txs = snap.docs.map(d => d.data()).sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(txs);
    }, console.error);

    return () => { unsubRests(); unsubUsers(); unsubTx(); };
  }, [user]);

  // --- Handlers: Donor ---
  const handleDonation = async (restaurantId, amount) => {
    const rest = restaurants.find(r => r.id === restaurantId);
    if (!rest) return;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', restaurantId.toString()), {
      funds: rest.funds + amount
    });
    setDonationSuccess(`Successfully funded $${amount} to ${rest.name}!`);
    setTimeout(() => setDonationSuccess(''), 4000);
  };

  // --- Handlers: Recipient / WebAuthn Simulation ---
  const triggerWebAuthn = (mode, restaurantId = null) => {
    setBiometricModal({ isOpen: true, mode, restaurantId });
    setScanStatus('idle');
  };

  const executeBiometricScan = () => {
    setScanStatus('scanning');
    
    // Simulate WebAuthn delay and device processing
    setTimeout(async () => {
      if (biometricModal.mode === 'enroll') {
        const newUserId = `usr_${Math.random().toString(36).substring(2, 9)}`;
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', newUserId), { 
          id: newUserId, 
          enrolledAt: new Date().toISOString() 
        });
        setCurrentUser({ id: newUserId });
        setScanStatus('success');
      } else if (biometricModal.mode === 'claim') {
        if (!currentUser) {
           // Simulate identifying user from fingerprint
           if (enrolledUsers.length > 0) {
             const matchedUser = enrolledUsers[enrolledUsers.length - 1];
             setCurrentUser(matchedUser);
             await processClaim(matchedUser.id, biometricModal.restaurantId);
           } else {
             setScanStatus('error'); // No users enrolled
             return;
           }
        } else {
           await processClaim(currentUser.id, biometricModal.restaurantId);
        }
      }
      
      setTimeout(() => {
        setBiometricModal({ isOpen: false, mode: 'enroll', restaurantId: null });
        setScanStatus('idle');
      }, 2000);
    }, 2000);
  };

  const processClaim = async (userId, restaurantId) => {
    const today = getTodayStr();
    const rest = restaurants.find(r => r.id === restaurantId);
    if (!rest) {
      setScanStatus('error');
      return;
    }

    const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
    const timestamp = Date.now();
    
    // Constraint 1: One restaurant per day limit
    const todayClaims = transactions.filter(t => t.userId === userId && t.date === today && t.status === 'approved');
    
    if (todayClaims.length > 0) {
      await addDoc(txRef, { userId, restaurantId, amount: 0, date: today, status: 'denied', reason: 'Daily limit reached (1 meal/day)', timestamp });
      setScanStatus('error');
      return;
    }

    // Constraint 2: Restaurant has enough funds
    const mealCost = 20;
    if (rest.funds < mealCost) {
      await addDoc(txRef, { userId, restaurantId, amount: 0, date: today, status: 'denied', reason: 'Insufficient restaurant funds', timestamp });
      setScanStatus('error');
      return;
    }

    // Success
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', restaurantId.toString()), {
      funds: rest.funds - mealCost,
      mealsServed: rest.mealsServed + 1
    });
    await addDoc(txRef, { userId, restaurantId, amount: mealCost, date: today, status: 'approved', reason: 'Success', timestamp });
    setScanStatus('success');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-200">
      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-emerald-500 p-2 rounded-lg">
                <Utensils className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-slate-800">Fund My Meal</span>
            </div>
            <div className="flex space-x-1 sm:space-x-4">
              <NavButton active={activeTab === 'recipient'} onClick={() => setActiveTab('recipient')} icon={<Fingerprint size={18}/>} text="Recipient" />
              <NavButton active={activeTab === 'donor'} onClick={() => setActiveTab('donor')} icon={<HeartHandshake size={18}/>} text="Donor" />
              <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={18}/>} text="Dashboard" />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'recipient' && (
          <RecipientView 
            restaurants={restaurants} 
            triggerWebAuthn={triggerWebAuthn} 
            currentUser={currentUser}
            transactions={transactions}
            enrolledUsers={enrolledUsers}
          />
        )}
        {activeTab === 'donor' && (
          <DonorView 
            restaurants={restaurants} 
            handleDonation={handleDonation} 
            donationSuccess={donationSuccess}
          />
        )}
        {activeTab === 'dashboard' && (
          <DashboardView 
            restaurants={restaurants} 
            transactions={transactions}
            enrolledUsers={enrolledUsers}
          />
        )}
      </main>

      {/* WebAuthn Biometric Modal */}
      {biometricModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <h3 className="text-xl font-bold text-slate-800 mb-2">
                {biometricModal.mode === 'enroll' ? 'Enroll Fingerprint' : 'Verify Identity'}
              </h3>
              <p className="text-sm text-slate-500 mb-8">
                {biometricModal.mode === 'enroll' 
                  ? 'Your biometric data never leaves your device. We only store a cryptographic proof.' 
                  : 'Scan your fingerprint to claim your $20 meal credit.'}
              </p>
              
              <div className="flex justify-center mb-8">
                <button 
                  onClick={executeBiometricScan}
                  disabled={scanStatus !== 'idle'}
                  className={`relative p-8 rounded-full transition-all duration-500 ${
                    scanStatus === 'idle' ? 'bg-slate-100 hover:bg-slate-200 cursor-pointer shadow-inner' :
                    scanStatus === 'scanning' ? 'bg-blue-50 cursor-wait' :
                    scanStatus === 'success' ? 'bg-emerald-50' : 'bg-red-50'
                  }`}
                >
                  {scanStatus === 'idle' && <Fingerprint className="w-16 h-16 text-slate-400" />}
                  {scanStatus === 'scanning' && (
                    <>
                      <Fingerprint className="w-16 h-16 text-blue-500 opacity-50" />
                      <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </>
                  )}
                  {scanStatus === 'success' && <CheckCircle2 className="w-16 h-16 text-emerald-500 animate-in zoom-in" />}
                  {scanStatus === 'error' && <XCircle className="w-16 h-16 text-red-500 animate-in zoom-in" />}
                </button>
              </div>

              <div className="h-6">
                {scanStatus === 'scanning' && <p className="text-blue-600 font-medium animate-pulse">Verifying cryptographic signature...</p>}
                {scanStatus === 'success' && <p className="text-emerald-600 font-medium">Verified successfully!</p>}
                {scanStatus === 'error' && <p className="text-red-600 font-medium">Verification failed or limit reached.</p>}
              </div>
            </div>
            
            {scanStatus === 'idle' && (
              <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setBiometricModal({ isOpen: false, mode: 'enroll', restaurantId: null })}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Sub-components ---

function NavButton({ active, onClick, icon, text }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
        active 
          ? 'bg-emerald-50 text-emerald-700' 
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{text}</span>
    </button>
  );
}

function RecipientView({ restaurants, triggerWebAuthn, currentUser, transactions, enrolledUsers }) {
  const isEnrolled = enrolledUsers.length > 0;
  const recentTransactions = transactions.filter(t => t.userId === currentUser?.id).slice(0, 3);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header section */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
        <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Frictionless Meal Access</h1>
        <p className="text-slate-500 max-w-2xl mx-auto mb-6">
          Access your daily $20 meal credit with zero paperwork and zero data leaks. 
          Your biometric signature is verified entirely on-device to ensure privacy.
        </p>
        
        {!isEnrolled ? (
          <button 
            onClick={() => triggerWebAuthn('enroll')}
            className="inline-flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-xl font-medium hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200"
          >
            <UserPlus size={20} />
            Enroll Device (WebAuthn)
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-6 py-3 rounded-xl font-medium border border-emerald-200">
            <CheckCircle2 size={20} />
            Device Enrolled & Secured
          </div>
        )}
      </div>

      {isEnrolled && (
        <div className="grid md:grid-cols-3 gap-8">
          {/* Claim Section */}
          <div className="md:col-span-2 space-y-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <MapPin className="text-emerald-500" /> Participating Restaurants
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {restaurants.map(rest => (
                <div key={rest.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-lg text-slate-800">{rest.name}</h3>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${rest.funds >= 20 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {rest.funds >= 20 ? 'Funds Available' : 'Insufficient Funds'}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => triggerWebAuthn('claim', rest.id)}
                    disabled={rest.funds < 20}
                    className="w-full py-2.5 bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Fingerprint size={18} />
                    Check-in & Claim $20
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Status Section */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <CreditCard className="text-blue-500" /> Today's Status
            </h2>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <div className="mb-6">
                <p className="text-sm text-slate-500 mb-1">Daily Limit</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold text-slate-800">$20</span>
                  <span className="text-sm text-slate-400 mb-1">/ 1 Meal</span>
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-800 mb-3">Recent Activity</p>
                {recentTransactions.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">No claims yet.</p>
                ) : (
                  <div className="space-y-3">
                    {recentTransactions.map((tx, idx) => (
                      <div key={idx} className="flex items-start gap-3 text-sm">
                        {tx.status === 'approved' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-medium text-slate-800">
                            {restaurants.find(r => r.id === tx.restaurantId)?.name}
                          </p>
                          <p className={`text-xs ${tx.status === 'approved' ? 'text-emerald-600' : 'text-red-500'}`}>
                            {tx.reason}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DonorView({ restaurants, handleDonation, donationSuccess }) {
  const [selectedRest, setSelectedRest] = useState(null);
  const [amount, setAmount] = useState(100);

  useEffect(() => {
    // Automatically select the first restaurant when the data loads
    if (restaurants.length > 0 && !selectedRest) {
      setSelectedRest(restaurants[0]);
    }
  }, [restaurants, selectedRest]);

  if (!selectedRest) {
    return (
      <div className="flex justify-center items-center h-64 text-slate-500">
        <div className="animate-spin mr-3"><Utensils size={24} className="text-emerald-500" /></div>
        Loading partner restaurants...
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center max-w-2xl mx-auto mb-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Fund Local Restaurants</h1>
        <p className="text-slate-500">
          Direct your donation to specific restaurants. Your funds are locked into a smart, 
          local ledger and distributed instantly when verified recipients check in.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 h-[600px]">
        {/* Leaflet Map Container */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
           <LeafletMap restaurants={restaurants} onSelect={(id) => setSelectedRest(restaurants.find(r => r.id === id))} selectedId={selectedRest.id} />
        </div>

        {/* Donation Form */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
          
          {donationSuccess && (
            <div className="bg-emerald-50 text-emerald-700 p-4 rounded-xl border border-emerald-200 mb-6 flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 size={20} className="shrink-0" />
              <span className="font-medium">{donationSuccess}</span>
            </div>
          )}

          <div className="mb-8">
            <span className="text-emerald-500 font-semibold tracking-wider text-xs uppercase">Selected Partner</span>
            <h2 className="text-2xl font-bold text-slate-800 mt-1">{selectedRest.name}</h2>
            <p className="text-slate-500 mt-2">Current pool: <span className="font-semibold text-slate-700">${selectedRest.funds}</span></p>
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-4">
              Select Funding Amount
            </label>
            <div className="mb-8">
              <div className="flex justify-between text-slate-400 text-xs mb-2 px-1">
                <span>$20</span>
                <span>$100</span>
                <span>$500</span>
              </div>
              <input 
                type="range" 
                min="20" 
                max="500" 
                step="20"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
            </div>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 mb-8 text-center">
              <p className="text-sm text-slate-500 mb-1">You are funding</p>
              <p className="text-4xl font-bold text-emerald-600">${amount}</p>
              <p className="text-xs text-slate-400 mt-2">Provides ~{Math.floor(amount / 20)} verified meals</p>
            </div>
          </div>

          <button 
            onClick={() => handleDonation(selectedRest.id, amount)}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-200"
          >
            <HeartHandshake size={24} />
            Complete Funding
          </button>
        </div>
      </div>
    </div>
  );
}

// Leaflet dynamic injection wrapper
function LeafletMap({ restaurants, onSelect, selectedId }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    let L = window.L;

    const initMap = () => {
      L = window.L;
      if (!mapRef.current || !L) return;

      if (!mapInstanceRef.current) {
        // Initialize map
        mapInstanceRef.current = L.map(mapRef.current, {
          zoomControl: false // Custom controls can be added if needed
        }).setView([43.0735, -89.4005], 15);

        // Add minimalist basemap
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(mapInstanceRef.current);
      }

      // Clear old markers
      mapInstanceRef.current.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
          mapInstanceRef.current.removeLayer(layer);
        }
      });

      // Custom icon
      const createIcon = (isSelected) => L.divIcon({
        className: 'custom-leaflet-icon',
        html: `<div style="
          background-color: ${isSelected ? '#10b981' : '#0f172a'}; 
          width: 24px; height: 24px; border-radius: 50%; 
          border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
          transform: translate(-50%, -50%);
        "></div>`,
        iconSize: [0, 0] // Handled by CSS inside html
      });

      restaurants.forEach(r => {
        const marker = L.marker([r.lat, r.lng], { icon: createIcon(r.id === selectedId) })
          .addTo(mapInstanceRef.current);
        
        marker.on('click', () => {
          onSelect(r.id);
          mapInstanceRef.current.flyTo([r.lat, r.lng], 16, { duration: 0.5 });
        });
      });
    };

    // Load Leaflet dynamically
    if (!window.L) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      initMap();
    }

    return () => {
      // Cleanup happens only on unmount
    };
  }, [restaurants, onSelect, selectedId]);

  return (
    <div className="absolute inset-0 z-0">
      <div ref={mapRef} className="w-full h-full z-10 outline-none" style={{ backgroundColor: '#f8fafc' }}></div>
      {/* Overlay to explain what this is if map loading is slow */}
      <div className="absolute top-4 left-4 z-[400] bg-white/90 backdrop-blur px-4 py-2 rounded-lg shadow-sm border border-slate-200 pointer-events-none">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <MapPin size={16} className="text-emerald-500" /> Live Restaurant Map
        </p>
      </div>
    </div>
  );
}

function DashboardView({ restaurants, transactions, enrolledUsers }) {
  const totalFunds = restaurants.reduce((sum, r) => sum + r.funds, 0);
  const totalMeals = restaurants.reduce((sum, r) => sum + r.mealsServed, 0);
  const approvedClaims = transactions.filter(t => t.status === 'approved').length;
  const blockedAttempts = transactions.filter(t => t.status === 'denied').length;

  const [aiReport, setAiReport] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const generateAIReport = async () => {
    setIsGenerating(true);
    try {
      const apiKey = "";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      
      const prompt = `You are a PR director. Write a short, inspiring 2-sentence impact report based on this live data from our social safety net: ${totalMeals} meals served, $${totalFunds} remaining in the pool, and ${blockedAttempts} fraud attempts safely prevented using biometric WebAuthn. Emphasize the privacy-first approach.`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      setAiReport(text || "Unable to generate report at this time.");
    } catch (error) {
      console.error(error);
      setAiReport("Error connecting to Gemini API.");
    }
    setIsGenerating(false);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Impact Dashboard</h1>
          <p className="text-slate-500 mt-1">Real-time metrics from the privacy-first ledger.</p>
        </div>
        <button 
          onClick={generateAIReport}
          disabled={isGenerating}
          className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Sparkles size={18} className={isGenerating ? "animate-spin" : ""} />
          {isGenerating ? "Analyzing..." : "Gemini AI Impact Report"}
        </button>
      </div>

      {aiReport && (
        <div className="bg-indigo-600 text-white p-6 rounded-2xl shadow-lg mb-8 animate-in fade-in zoom-in duration-300">
          <div className="flex items-start gap-4">
            <Sparkles className="w-8 h-8 text-indigo-200 shrink-0" />
            <div>
              <h3 className="font-bold text-indigo-100 mb-2">AI Pitch Generator</h3>
              <p className="text-lg leading-relaxed">{aiReport}</p>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Available Funds" value={`$${totalFunds}`} icon={<TrendingUp size={20} className="text-emerald-500"/>} trend="+12% this week" />
        <StatCard title="Meals Served" value={totalMeals} icon={<Utensils size={20} className="text-blue-500"/>} trend="3 active partners" />
        <StatCard title="Enrolled Users" value={enrolledUsers.length} icon={<Fingerprint size={20} className="text-indigo-500"/>} trend="WebAuthn secured" />
        <StatCard title="Fraud Prevented" value={blockedAttempts} icon={<ShieldCheck size={20} className="text-slate-500"/>} trend="Attempts blocked" />
      </div>

      <div className="grid lg:grid-cols-3 gap-8 mt-8">
        {/* Restaurant Breakdown */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800">Restaurant Liquidity</h2>
          </div>
          <div className="p-0">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 text-sm">
                <tr>
                  <th className="px-6 py-4 font-medium">Partner Name</th>
                  <th className="px-6 py-4 font-medium">Available Pool</th>
                  <th className="px-6 py-4 font-medium">Meals Delivered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {restaurants.map(rest => (
                  <tr key={rest.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-800">{rest.name}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-full max-w-[100px] h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-400" style={{ width: `${Math.min((rest.funds / 500) * 100, 100)}%` }}></div>
                        </div>
                        <span className="font-semibold text-slate-700">${rest.funds}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{rest.mealsServed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Real-time Ledger */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800">Network Ledger</h2>
          </div>
          <div className="p-6 flex-1 overflow-y-auto space-y-4">
            {transactions.length === 0 ? (
              <p className="text-sm text-slate-400 text-center italic mt-10">Waiting for activity...</p>
            ) : (
              transactions.map((tx, idx) => (
                <div key={idx} className="flex gap-4 border-l-2 pl-4 py-1" style={{ borderColor: tx.status === 'approved' ? '#10b981' : '#ef4444' }}>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {tx.status === 'approved' ? 'Meal Claimed' : 'Claim Denied'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {restaurants.find(r => r.id === tx.restaurantId)?.name || 'Unknown Partner'} • {tx.userId.substring(0,8)}...
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${tx.status === 'approved' ? 'text-emerald-600' : 'text-slate-400'}`}>
                      ${tx.amount}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, trend }) {
  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 bg-slate-50 rounded-lg">{icon}</div>
      </div>
      <div>
        <h3 className="text-slate-500 text-sm font-medium mb-1">{title}</h3>
        <p className="text-3xl font-bold text-slate-800 mb-2">{value}</p>
        <p className="text-xs text-slate-400 font-medium">{trend}</p>
      </div>
    </div>
  );
}