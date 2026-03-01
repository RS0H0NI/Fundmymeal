import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, Utensils, HeartHandshake, Fingerprint, 
  CheckCircle2, XCircle, Store, ShieldCheck, Database, Sparkles, AlertCircle, Globe, Activity
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
 * BACKEND CONFIGURATION
 * 1. Deploy server.js to Cloud Run.
 * 2. If you see "Service Unavailable", check the 'Logs' tab in Cloud Run console.
 * 3. Ensure your package.json has "start": "node server.js".
 */
const BACKEND_URL = "https://fundmymeal-718159830898.us-central1.run.app"; 

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
  const [isSeeding, setIsSeeding] = useState(false);
  const [errorLog, setErrorLog] = useState(null);
  
  const [biometricModal, setBiometricModal] = useState({ isOpen: false, restaurantId: null });
  const [scanStatus, setScanStatus] = useState('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [backendStatus, setBackendStatus] = useState('unknown'); // 'online', 'offline', 'unknown'

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});

  // Check Backend Health
  useEffect(() => {
    if (!BACKEND_URL || BACKEND_URL.includes("your-backend-service")) return;
    
    const checkHealth = async () => {
      try {
        // We ping a known endpoint to see if the server responds at all
        const res = await fetch(`${BACKEND_URL}/api/auth/generate-registration`);
        if (res.status === 404 || res.status === 200 || res.status === 400) {
          setBackendStatus('online');
        } else {
          setBackendStatus('offline');
        }
      } catch (e) {
        setBackendStatus('offline');
      }
    };
    checkHealth();
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (firebaseConfig.apiKey === "AIzaSy...") {
          setErrorLog("Configuration Missing: Paste your firebaseConfig values into the code.");
          setLoading(false);
          return;
        }
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        if (err.code === 'auth/configuration-not-found') {
          setErrorLog("Auth Error: Enable 'Anonymous' auth in Firebase Console.");
        } else {
          setErrorLog("Auth failed: " + err.message);
        }
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
      if (docs.length > 0) setErrorLog(null);
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
    if (mapInstanceRef.current && window.L && restaurants.length > 0) {
      restaurants.forEach(rest => {
        if (markersRef.current[rest.id]) {
          markersRef.current[rest.id].setPopupContent(`<b>${rest.name}</b><br>Funds: $${rest.funds}`);
        } else if (rest.lat && rest.lng) {
          const marker = window.L.marker([rest.lat, rest.lng])
            .addTo(mapInstanceRef.current)
            .bindPopup(`<b>${rest.name}</b><br>Funds: $${rest.funds}`);
          markersRef.current[rest.id] = marker;
        }
      });
    }
  }, [restaurants]);

  const seedDatabase = async () => {
    if (!user || isSeeding) return;
    setIsSeeding(true);
    setErrorLog(null);
    try {
      const initialRestaurants = [
        { id: 'ians-pizza', name: "Ian's Pizza State St", lat: 43.0753, lng: -89.3948, funds: 120, mealsServed: 45 },
        { id: 'short-stack', name: "Short Stack Eatery", lat: 43.0744, lng: -89.3912, funds: 80, mealsServed: 22 },
        { id: 'brats', name: "State Street Brats", lat: 43.0750, lng: -89.3932, funds: 210, mealsServed: 89 }
      ];
      for (const rest of initialRestaurants) {
        const restRef = doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', rest.id);
        await setDoc(restRef, { ...rest, updatedAt: serverTimestamp() });
      }
      setScanMessage("Database Seeded!");
    } catch (err) {
      setErrorLog(err.message);
    } finally {
      setIsSeeding(false);
    }
  };

  const executeScan = async () => {
    if (scanStatus !== 'idle' || !user) return;
    setScanStatus('scanning');
    setScanMessage('Connecting to secure gateway...');

    const restId = biometricModal.restaurantId;

    // Simulation Fallback if URL is not set
    if (!BACKEND_URL || BACKEND_URL.includes("your-backend-service")) {
      await new Promise(r => setTimeout(r, 2000));
      const restRef = doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', restId);
      try {
        await runTransaction(db, async (tx) => {
          const d = await tx.get(restRef);
          tx.update(restRef, { funds: d.data().funds - 20, mealsServed: d.data().mealsServed + 1 });
        });
        setScanStatus('success');
        setScanMessage('Claimed! (Local Demo Mode)');
      } catch (e) {
        setScanStatus('error');
        setScanMessage(e.message);
      }
      setTimeout(() => setBiometricModal({ isOpen: false }), 2000);
      return;
    }

    try {
      const optionsResp = await fetch(`${BACKEND_URL}/api/auth/generate-authentication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid })
      });
      
      if (!optionsResp.ok) {
        const errorText = await optionsResp.text();
        throw new Error(`Server Error: ${optionsResp.status}. Check Cloud Run logs.`);
      }
      
      const options = await optionsResp.json();
      setScanMessage("Waiting for Biometric...");
      
      const verifyResp = await fetch(`${BACKEND_URL}/api/auth/verify-authentication-and-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, restaurantId: restId })
      });
      
      const result = await verifyResp.json();
      if (result.success) {
        setScanStatus('success');
        setScanMessage('Verified & Deducted!');
      } else {
        throw new Error(result.error || "Verification failed");
      }
    } catch (err) {
      setScanStatus('error');
      setScanMessage(err.message);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-sans text-gray-500">Connecting...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center space-x-2 text-emerald-600">
          <Utensils size={28} strokeWidth={2.5} />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">FundMyMeal</h1>
        </div>
        
        <div className="flex items-center gap-4">
          {backendStatus !== 'unknown' && (
            <div className={`hidden md:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${backendStatus === 'online' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600 animate-pulse'}`}>
              <Activity size={12} />
              {backendStatus === 'online' ? 'API LIVE' : 'API OFFLINE (503)'}
            </div>
          )}
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setActiveMode('recipient')} className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeMode === 'recipient' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Recipient</button>
            <button onClick={() => setActiveMode('donor')} className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeMode === 'donor' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Donor</button>
          </div>
        </div>
      </nav>

      {errorLog && (
        <div className="bg-red-50 border-b border-red-100 p-4 flex flex-col items-center justify-center gap-2 text-red-700 text-sm font-medium text-center">
          <AlertCircle size={18} /> 
          <p>{errorLog}</p>
        </div>
      )}

      {restaurants.length === 0 && !errorLog && (
        <div className="bg-emerald-50 border-b border-emerald-100 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="text-emerald-600" size={20} />
            <p className="text-emerald-800 text-sm font-medium">{scanMessage || "Database connected. Seed initial restaurants?"}</p>
          </div>
          <button onClick={seedDatabase} disabled={isSeeding} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200/50">
            <Sparkles size={16} /> {isSeeding ? 'Seeding...' : 'Seed Data'}
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {restaurants.map((rest) => (
              <div key={rest.id} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <h3 className="font-bold text-xl text-gray-900 flex items-center gap-2"><Store size={20} className="text-gray-400" />{rest.name}</h3>
                <div className="bg-gray-50 p-4 rounded-xl my-4 flex justify-between items-center border border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Available Funds</p>
                    <p className={`text-2xl font-bold ${rest.funds >= 20 ? 'text-emerald-600' : 'text-red-500'}`}>${rest.funds}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Total Served</p>
                    <p className="text-xl font-bold text-gray-700">{rest.mealsServed || 0}</p>
                  </div>
                </div>
                {activeMode === 'donor' ? (
                  <button className="w-full py-3 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">Fund $50</button>
                ) : (
                  <button onClick={() => setBiometricModal({ isOpen: true, restaurantId: rest.id })} disabled={rest.funds < 20} className={`w-full py-3 rounded-xl font-bold transition-colors ${rest.funds >= 20 ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                    Claim $20 Meal
                  </button>
                )}
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
            <h3 className="text-xl font-bold text-gray-900">Biometric Verification</h3>
            <p className="text-sm text-gray-500 mt-2">Connecting to secure hardware enclave...</p>
            <button onClick={executeScan} disabled={scanStatus !== 'idle'} className={`mt-6 relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${scanStatus === 'idle' ? 'bg-gray-50 border-4 border-gray-100' : scanStatus === 'scanning' ? 'bg-blue-50 border-4 border-blue-100' : 'bg-emerald-50 border-4 border-emerald-100'}`}>
              <Fingerprint className={`w-16 h-16 ${scanStatus === 'scanning' ? 'text-blue-500 animate-pulse' : 'text-gray-400'}`} />
            </button>
            <p className={`mt-6 font-medium ${scanStatus === 'error' ? 'text-red-500' : 'text-gray-600'}`}>{scanMessage || 'Tap fingerprint icon to verify'}</p>
            {scanStatus === 'idle' && (
              <button onClick={() => setBiometricModal({ isOpen: false })} className="mt-4 text-sm font-bold text-gray-400 hover:text-gray-600">Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}