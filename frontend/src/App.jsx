import React, { useState, useEffect, useRef } from 'react';
import { 
  Utensils, Fingerprint, Store, ShieldCheck, Database, Sparkles, AlertCircle, Activity, Globe
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, onSnapshot, 
  runTransaction, serverTimestamp, setDoc 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';

/**
 * API calls use relative paths since frontend & backend are on the same server
 * This works whether running locally or deployed on Azure
 */
const BACKEND_URL = ""; 

// Fill these with your Firebase Console values
const firebaseConfig = {
  apiKey: "AIzaSyBEtXersVjHeCtDXcxYreYIleIcEjFNf30",
  authDomain: "fund-my-meal-77b29.firebaseapp.com",
  projectId: "fund-my-meal-77b29",
  storageBucket: "fund-my-meal-77b29.firebasestorage.app",
  messagingSenderId: "348621150715",
  appId: "1:348621150715:web:758b7881d8f7e47e2a535e"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fund-my-meal-v1';

export default function App() {
  const [activeMode, setActiveMode] = useState('recipient');
  const [restaurants, setRestaurants] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorLog, setErrorLog] = useState(null);
  
  const [biometricModal, setBiometricModal] = useState({ isOpen: false, restaurantId: null });
  const [scanStatus, setScanStatus] = useState('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [apiOnline, setApiOnline] = useState(null);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  // Heartbeat check for Backend
  useEffect(() => {
    const checkApi = async () => {
      try {
        // Checking the /health route
        const res = await fetch('/health');
        setApiOnline(res.ok);
      } catch (e) {
        setApiOnline(false);
      }
    };
    checkApi();
    const interval = setInterval(checkApi, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (firebaseConfig.apiKey === "AIzaSy...") {
          setErrorLog("Setup Required: Paste your firebaseConfig into App.jsx");
          setLoading(false);
          return;
        }
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        setErrorLog("Auth failed: " + err.message);
        setLoading(false);
      }
    };
    initAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    const restCollection = collection(db, 'artifacts', appId, 'public', 'data', 'restaurants');
    const unsubscribeData = onSnapshot(restCollection, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setRestaurants(docs);
    }, (error) => {
      setErrorLog("Firestore Error: " + error.message);
    });
    return () => unsubscribeData();
  }, [user]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapInstanceRef.current && window.L) {
      const map = window.L.map(mapContainerRef.current).setView([43.0731, -89.4012], 14);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{y}.png').addTo(map);
      mapInstanceRef.current = map;
    }
  }, []);

  /**
   * EXECUTE CLAIM
   * This sends the request to the backend API
   */
  const executeScan = async () => {
    if (scanStatus !== 'idle' || !user) return;
    
    setScanStatus('scanning');
    setScanMessage('Authenticating...');

    const restId = biometricModal.restaurantId;

    try {
      // We skip the challenge generation for this demo and go straight to the claim
      // which handles the Firestore transaction on the server side.
      const verifyResp = await fetch('/api/auth/verify-authentication-and-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: user.uid, 
          restaurantId: restId,
          appId: appId 
        })
      });
      
      const result = await verifyResp.json();
      
      if (result.success) {
        setScanStatus('success');
        setScanMessage('Identity Verified. $20 Meal Claimed!');
        setTimeout(() => {
          setBiometricModal({ isOpen: false, restaurantId: null });
          setScanStatus('idle');
          setScanMessage('');
        }, 2500);
      } else {
        throw new Error(result.error || "Verification failed");
      }
    } catch (err) {
      setScanStatus('error');
      setScanMessage(err.message);
      setTimeout(() => setScanStatus('idle'), 4000);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-sans text-gray-500">Connecting to Cloud...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center space-x-2 text-emerald-600">
          <Utensils size={28} strokeWidth={2.5} />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">FundMyMeal</h1>
        </div>
        <div className="flex items-center gap-4">
          {apiOnline !== null && (
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${apiOnline ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600 animate-pulse'}`}>
              <Activity size={10} /> {apiOnline ? 'API Connected' : 'API Connection Failed'}
            </div>
          )}
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setActiveMode('recipient')} className={`px-4 md:px-6 py-2 rounded-lg font-semibold transition-all text-sm md:text-base ${activeMode === 'recipient' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Recipient</button>
            <button onClick={() => setActiveMode('donor')} className={`px-4 md:px-6 py-2 rounded-lg font-semibold transition-all text-sm md:text-base ${activeMode === 'donor' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Donor</button>
          </div>
        </div>
      </nav>

      {errorLog && (
        <div className="bg-red-50 p-4 text-red-700 text-sm font-medium text-center flex items-center justify-center gap-2">
          <AlertCircle size={16} /> {errorLog}
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {restaurants.map((rest) => (
              <div key={rest.id} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm transition-all hover:shadow-md">
                <h3 className="font-bold text-xl text-gray-900 flex items-center gap-2"><Store size={20} className="text-gray-400" />{rest.name}</h3>
                <div className="bg-gray-50 p-4 rounded-xl my-4 flex justify-between items-center border border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Available Funds</p>
                    <p className={`text-2xl font-bold ${rest.funds >= 20 ? 'text-emerald-600' : 'text-red-500'}`}>${rest.funds}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 font-semibold uppercase mb-1">Served</p>
                    <p className="text-xl font-bold text-gray-700">{rest.mealsServed || 0}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setBiometricModal({ isOpen: true, restaurantId: rest.id })} 
                  disabled={rest.funds < 20 || !apiOnline}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${rest.funds >= 20 && apiOnline ? 'bg-gray-900 text-white hover:bg-black shadow-lg shadow-gray-200' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  {apiOnline ? (activeMode === 'donor' ? 'Donate $20' : 'Claim $20 Meal') : 'API Offline'}
                </button>
              </div>
            ))}
          </div>
        </div>
        
        <div className="lg:col-span-1 h-[400px] lg:h-auto bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
          <div ref={mapContainerRef} className="w-full h-full z-0" />
        </div>
      </main>

      {biometricModal.isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center flex flex-col items-center">
            <ShieldCheck className="w-12 h-12 text-emerald-500 mb-3" />
            <h3 className="text-xl font-bold text-gray-900">Secure Claim</h3>
            <button onClick={executeScan} disabled={scanStatus !== 'idle'} className={`mt-6 relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${scanStatus === 'idle' ? 'bg-gray-50 border-4 border-gray-100 shadow-inner' : scanStatus === 'scanning' ? 'bg-blue-50 border-4 border-blue-100' : 'bg-emerald-50 border-4 border-emerald-100'}`}>
              <Fingerprint className={`w-16 h-16 ${scanStatus === 'scanning' ? 'text-blue-500 animate-pulse' : scanStatus === 'success' ? 'text-emerald-500' : 'text-gray-400'}`} />
            </button>
            <p className={`mt-6 font-medium text-sm px-4 h-10 ${scanStatus === 'error' ? 'text-red-500' : 'text-gray-600'}`}>{scanMessage || 'Tap to verify biometrics'}</p>
            {scanStatus === 'idle' && (
              <button onClick={() => setBiometricModal({ isOpen: false })} className="mt-4 text-sm font-bold text-gray-400 hover:text-gray-600 underline underline-offset-4">Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}