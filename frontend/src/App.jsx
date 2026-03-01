import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, Utensils, HeartHandshake, Fingerprint, 
  CheckCircle2, XCircle, Store, ShieldCheck, Database, Sparkles, AlertCircle
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
 * MANDATORY CONFIGURATION:
 * Make sure these values match your project exactly.
 * You can find these in Project Settings > General > Your Apps in the Firebase Console.
 */


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

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});

  // 1. Auth Logic
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (firebaseConfig.apiKey === "AIzaSy...") {
          setErrorLog("Configuration Missing: Please paste your firebaseConfig values from the Firebase Console into the code.");
          setLoading(false);
          return;
        }

        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
        if (err.code === 'auth/configuration-not-found') {
          setErrorLog("Auth Error: You must enable 'Anonymous' authentication in the Firebase Console (Authentication > Sign-in method).");
        } else {
          setErrorLog("Authentication failed: " + err.message);
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

  // 2. Real-time Firestore Listener
  useEffect(() => {
    if (!user) return;

    const restCollection = collection(db, 'artifacts', appId, 'public', 'data', 'restaurants');
    
    const unsubscribeData = onSnapshot(restCollection, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setRestaurants(docs);
      if (docs.length > 0) setErrorLog(null); // Clear errors if we get data
    }, (error) => {
      console.error("Firestore read error:", error);
      if (error.code === 'permission-denied') {
        setErrorLog("Permission Denied: Check your Firestore Rules tab.");
      } else {
        setErrorLog("Firestore Connection Error: " + error.message);
      }
    });

    return () => unsubscribeData();
  }, [user]);

  // 3. Map Syncing
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

  // --- Seed Data Helper ---
  const seedDatabase = async () => {
    if (!user || isSeeding) return;
    setIsSeeding(true);
    setErrorLog(null);
    setScanMessage("Testing connection...");
    
    const initialRestaurants = [
      { id: 'ians-pizza', name: "Ian's Pizza State St", lat: 43.0753, lng: -89.3948, funds: 120, mealsServed: 45 },
      { id: 'short-stack', name: "Short Stack Eatery", lat: 43.0744, lng: -89.3912, funds: 80, mealsServed: 22 },
      { id: 'brats', name: "State Street Brats", lat: 43.0750, lng: -89.3932, funds: 210, mealsServed: 89 },
      { id: 'med-cafe', name: "Mediterranean Cafe", lat: 43.0742, lng: -89.3955, funds: 15, mealsServed: 34 }
    ];

    try {
      // Step A: Test Write
      const testRef = doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', '_connection_test');
      await setDoc(testRef, { test: true, time: Date.now(), user: user.uid });
      
      setScanMessage("Writing restaurant data...");

      // Step B: Seed
      for (const rest of initialRestaurants) {
        const restRef = doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', rest.id);
        await setDoc(restRef, {
          ...rest,
          status: 'active',
          updatedAt: serverTimestamp()
        });
      }
      
      setScanMessage("Database ready!");
      setTimeout(() => setScanMessage(""), 3000);
      
    } catch (err) {
      console.error("Seeding Error:", err);
      setErrorLog(err.message);
      if (err.code === 'permission-denied') {
        setErrorLog("Write Denied. Did you set Firestore Rules to 'Test Mode'?");
      } else if (err.message.includes("network")) {
        setErrorLog("Network Error. Check your internet or Firebase Config.");
      }
    } finally {
      setIsSeeding(false);
    }
  };

  const handleFundRestaurant = async (id, amount) => {
    if (!user) return;
    const restRef = doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', id);
    try {
      await runTransaction(db, async (transaction) => {
        const restDoc = await transaction.get(restRef);
        if (!restDoc.exists()) throw "Restaurant does not exist!";
        const newFunds = (restDoc.data().funds || 0) + amount;
        transaction.update(restRef, { funds: newFunds });
      });
    } catch (e) {
      setErrorLog("Transaction failed: " + e.message);
    }
  };

  const executeScan = async () => {
    if (scanStatus !== 'idle' || !user) return;
    setScanStatus('scanning');
    setScanMessage('Authenticating...');
    const restId = biometricModal.restaurantId;
    const restRef = doc(db, 'artifacts', appId, 'public', 'data', 'restaurants', restId);
    const claimRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'claims'));

    try {
      await new Promise(r => setTimeout(r, 1000));
      await runTransaction(db, async (transaction) => {
        const restDoc = await transaction.get(restRef);
        const data = restDoc.data();
        if (data.funds < 20) throw "Insufficient funds.";
        transaction.update(restRef, { 
          funds: data.funds - 20,
          mealsServed: (data.mealsServed || 0) + 1
        });
        transaction.set(claimRef, { restaurantId: restId, timestamp: serverTimestamp(), amount: 20 });
      });
      setScanStatus('success');
      setScanMessage('Claim Successful!');
      setTimeout(() => setBiometricModal({ isOpen: false, restaurantId: null }), 1500);
    } catch (err) {
      setScanStatus('error');
      setScanMessage(err.toString());
      setTimeout(() => setScanStatus('idle'), 3000);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-sans text-gray-500">Connecting to Firebase...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center space-x-2 text-emerald-600">
          <Utensils size={28} strokeWidth={2.5} />
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">FundMyMeal</h1>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button onClick={() => setActiveMode('recipient')} className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeMode === 'recipient' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Recipient</button>
          <button onClick={() => setActiveMode('donor')} className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeMode === 'donor' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>Donor</button>
        </div>
      </nav>

      {/* Error / Status Log */}
      {errorLog && (
        <div className="bg-red-50 border-b border-red-100 p-4 flex flex-col items-center justify-center gap-2 text-red-700 text-sm font-medium text-center">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} /> 
            <span className="font-bold uppercase tracking-tight">System Alert</span>
          </div>
          <p>{errorLog}</p>
        </div>
      )}

      {restaurants.length === 0 && !errorLog && (
        <div className="bg-emerald-50 border-b border-emerald-100 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="text-emerald-600" size={20} />
            <p className="text-emerald-800 text-sm font-medium">{scanMessage || "Connection established. Ready to seed database?"}</p>
          </div>
          <button onClick={seedDatabase} disabled={isSeeding} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all active:scale-95 shadow-lg shadow-emerald-200/50">
            {isSeeding ? 'Writing...' : <><Sparkles size={16} /> Seed Initial Data</>}
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {restaurants.length === 0 && !isSeeding && (
              <div className="col-span-full py-12 text-center bg-white rounded-2xl border-2 border-dashed border-gray-200">
                <Store className="mx-auto text-gray-300 mb-4" size={48} />
                <p className="text-gray-500 font-medium">No restaurants found in database.</p>
                <p className="text-gray-400 text-sm mt-1">Make sure you have created the Firestore Database and enabled Anonymous Auth.</p>
              </div>
            )}
            {restaurants.map((rest) => (
              <div key={rest.id} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm transition-all hover:scale-[1.01]">
                <h3 className="font-bold text-xl text-gray-900 flex items-center gap-2"><Store size={20} className="text-gray-400" />{rest.name}</h3>
                <div className="bg-gray-50 p-4 rounded-xl my-4 flex justify-between items-center border border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Pool</p>
                    <p className={`text-2xl font-bold ${rest.funds >= 20 ? 'text-emerald-600' : 'text-red-500'}`}>${rest.funds}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Served</p>
                    <p className="text-xl font-bold text-gray-700">{rest.mealsServed || 0}</p>
                  </div>
                </div>
                {activeMode === 'donor' ? (
                  <button onClick={() => handleFundRestaurant(rest.id, 50)} className="w-full py-3 rounded-xl font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm tracking-wide">Fund $50</button>
                ) : (
                  <button onClick={() => setBiometricModal({ isOpen: true, restaurantId: rest.id })} disabled={rest.funds < 20} className={`w-full py-3 rounded-xl font-bold transition-colors shadow-sm tracking-wide ${rest.funds >= 20 ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                    Claim $20 Meal
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-1 h-[400px] lg:h-auto bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative min-h-[400px]">
          <div ref={mapContainerRef} className="w-full h-full z-0" />
        </div>
      </main>

      {biometricModal.isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center flex flex-col items-center">
            <ShieldCheck className="w-12 h-12 text-emerald-500 mb-3" />
            <h3 className="text-xl font-bold text-gray-900">Verify Identity</h3>
            <button onClick={executeScan} disabled={scanStatus !== 'idle'} className={`mt-6 relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${scanStatus === 'idle' ? 'bg-gray-50 border-4 border-gray-100' : scanStatus === 'scanning' ? 'bg-blue-50 border-4 border-blue-100' : 'bg-emerald-50 border-4 border-emerald-100'}`}>
              <Fingerprint className={`w-16 h-16 ${scanStatus === 'scanning' ? 'text-blue-500 animate-pulse' : 'text-gray-400'}`} />
            </button>
            <p className="mt-6 font-medium text-gray-600">{scanMessage || 'Tap to verify'}</p>
            {scanStatus === 'idle' && (
              <button onClick={() => setBiometricModal({ isOpen: false, restaurantId: null })} className="mt-4 text-sm font-bold text-gray-400">Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}