import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, Utensils, HeartHandshake, Fingerprint, 
  CheckCircle2, XCircle, Store, ShieldCheck, User 
} from 'lucide-react';

// 🛑 Dummy Data (Replacing individuals with Restaurants)
const INITIAL_RESTAURANTS = [
  { id: 1, name: "Memorial Union Der Rathskeller", lat: 43.0762, lng: -89.4000, funds: 40, mealsServed: 12 },
  { id: 2, name: "Fresh Madison Market", lat: 43.0735, lng: -89.3955, funds: 15, mealsServed: 34 }, // Less than $20
  { id: 3, name: "State Street Brats", lat: 43.0747, lng: -89.3921, funds: 120, mealsServed: 8 },
  { id: 4, name: "Mickies Dairy Bar", lat: 43.0698, lng: -89.4087, funds: 300, mealsServed: 45 }
];

export default function App() {
  const [activeMode, setActiveMode] = useState('recipient'); // 'recipient' or 'donor'
  const [restaurants, setRestaurants] = useState(INITIAL_RESTAURANTS);
  
  // Biometric Modal State
  const [biometricModal, setBiometricModal] = useState({ isOpen: false, restaurantId: null });
  const [scanStatus, setScanStatus] = useState('idle'); // idle, scanning, success, error
  const [scanMessage, setScanMessage] = useState('Place your thumb on the scanner');

  // Map Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  // 🗺️ Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initMap = () => {
      if (window.L && !mapInstanceRef.current) {
        const map = window.L.map(mapContainerRef.current).setView([43.0731, -89.4012], 14);
        
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        delete window.L.Icon.Default.prototype._getIconUrl;
        window.L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        });

        // Draw markers
        restaurants.forEach(rest => {
          const isFunded = rest.funds >= 20;
          const markerColor = isFunded ? 'green' : 'red';
          
          window.L.marker([rest.lat, rest.lng])
            .addTo(map)
            .bindPopup(`<b>${rest.name}</b><br>Available Funds: $${rest.funds}`);
        });

        mapInstanceRef.current = map;
      }
    };

    // Dynamically load Leaflet
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (!document.getElementById('leaflet-script')) {
      const script = document.createElement('script');
      script.id = 'leaflet-script';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = initMap;
      document.head.appendChild(script);
    } else {
      initMap();
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []); // Empty dependency array so map only loads once

  // 💰 Donor Action: Fund a restaurant
  const handleFundRestaurant = (id, amount) => {
    setRestaurants(restaurants.map(rest => 
      rest.id === id ? { ...rest, funds: rest.funds + amount } : rest
    ));
    alert(`Successfully added $${amount} to the restaurant's pool!`);
  };

  // 🖐️ Recipient Action: Trigger thumbprint modal
  const triggerThumbprint = (restaurantId) => {
    setBiometricModal({ isOpen: true, restaurantId });
    setScanStatus('idle');
    setScanMessage('Place your thumb on the scanner');
  };

  // 🔒 Simulate Biometric Scan & Claim Logic
  const executeScan = () => {
    if (scanStatus !== 'idle') return;
    
    setScanStatus('scanning');
    setScanMessage('Verifying biometric signature...');

    setTimeout(() => {
      const rest = restaurants.find(r => r.id === biometricModal.restaurantId);
      
      if (rest.funds >= 20) {
        // Success: Deduct $20
        setRestaurants(restaurants.map(r => 
          r.id === rest.id ? { ...r, funds: r.funds - 20, mealsServed: r.mealsServed + 1 } : r
        ));
        setScanStatus('success');
        setScanMessage('Identity verified! $20 meal claimed.');
      } else {
        // Fail: Not enough funds
        setScanStatus('error');
        setScanMessage('Insufficient funds at this location.');
      }

      // Close modal after showing result
      setTimeout(() => {
        setBiometricModal({ isOpen: false, restaurantId: null });
      }, 2500);

    }, 2000); // Simulate 2 second scanning delay
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      
      {/* 🧭 Navbar */}
      <nav className="bg-white shadow-sm px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center space-x-2 text-emerald-600">
          <Utensils size={28} strokeWidth={2.5} />
          <h1 className="text-2xl font-bold tracking-tight">FundMyMeal</h1>
        </div>
        
        {/* Mode Toggle */}
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button 
            onClick={() => setActiveMode('recipient')}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeMode === 'recipient' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            I need a meal
          </button>
          <button 
            onClick={() => setActiveMode('donor')}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeMode === 'donor' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            I want to fund
          </button>
        </div>
      </nav>

      {/* 🎯 Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Feed */}
        <div className="lg:col-span-2 space-y-6">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">
              {activeMode === 'donor' ? 'Fund a Local Restaurant' : 'Claim a Meal'}
            </h2>
            <p className="text-gray-500 mt-2 text-lg">
              {activeMode === 'donor' 
                ? 'Add funds to a restaurant\'s pool. Students in need can claim a $20 meal instantly using just their thumbprint.' 
                : 'Check in at a participating restaurant to claim a $20 meal credit. No questions asked. Verified securely on your device.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {restaurants.map((rest) => (
              <div key={rest.id} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-xl text-gray-900 flex items-center gap-2">
                      <Store size={20} className="text-gray-400" />
                      {rest.name}
                    </h3>
                    <p className="text-sm text-gray-500 flex items-center mt-1">
                      <MapPin size={14} className="mr-1" /> UW-Madison Campus
                    </p>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-xl mb-6 flex justify-between items-center border border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Available Pool</p>
                    <p className={`text-2xl font-bold ${rest.funds >= 20 ? 'text-emerald-600' : 'text-red-500'}`}>
                      ${rest.funds}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Meals Served</p>
                    <p className="text-xl font-bold text-gray-700">{rest.mealsServed}</p>
                  </div>
                </div>

                {/* Dynamic Button based on Mode */}
                {activeMode === 'donor' ? (
                  <button 
                    onClick={() => handleFundRestaurant(rest.id, 50)}
                    className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                  >
                    <HeartHandshake size={20} />
                    Fund $50
                  </button>
                ) : (
                  <button 
                    onClick={() => triggerThumbprint(rest.id)}
                    disabled={rest.funds < 20}
                    className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-sm ${
                      rest.funds >= 20 
                        ? 'bg-gray-900 text-white hover:bg-gray-800' 
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Fingerprint size={20} />
                    {rest.funds >= 20 ? 'Claim $20 Meal' : 'Insufficient Funds'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Map Sidebar */}
        <div className="lg:col-span-1 h-[600px] lg:h-auto bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
          <div className="absolute top-4 left-4 z-[400] bg-white/95 backdrop-blur-sm px-4 py-2 rounded-lg font-bold text-sm shadow-sm border border-gray-100 text-gray-700 flex items-center gap-2">
            <MapPin size={16} className="text-emerald-500" />
            Partner Locations
          </div>
          <div ref={mapContainerRef} className="w-full h-full min-h-[500px] z-0" />
        </div>

      </main>

      {/* 🔒 Biometric Thumbprint Modal */}
      {biometricModal.isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all">
            
            <div className="bg-gray-50 p-6 text-center border-b border-gray-100">
              <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-gray-900">Verify Identity</h3>
              <p className="text-sm text-gray-500 mt-1">Claiming meal at {restaurants.find(r => r.id === biometricModal.restaurantId)?.name}</p>
            </div>
            
            <div className="p-8 text-center flex flex-col items-center">
              
              {/* The Thumbprint Scanner Button */}
              <button 
                onClick={executeScan}
                disabled={scanStatus !== 'idle'}
                className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
                  scanStatus === 'idle' ? 'bg-gray-50 border-4 border-gray-100 hover:bg-gray-100 cursor-pointer shadow-inner' :
                  scanStatus === 'scanning' ? 'bg-blue-50 border-4 border-blue-100 cursor-wait' :
                  scanStatus === 'success' ? 'bg-emerald-50 border-4 border-emerald-100' : 
                  'bg-red-50 border-4 border-red-100'
                }`}
              >
                {scanStatus === 'idle' && <Fingerprint className="w-16 h-16 text-gray-400" />}
                
                {scanStatus === 'scanning' && (
                  <>
                    <Fingerprint className="w-16 h-16 text-blue-500 opacity-50" />
                    <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </>
                )}
                
                {scanStatus === 'success' && <CheckCircle2 className="w-16 h-16 text-emerald-500" />}
                
                {scanStatus === 'error' && <XCircle className="w-16 h-16 text-red-500" />}
              </button>
              
              <p className={`mt-6 font-medium ${
                scanStatus === 'error' ? 'text-red-600' :
                scanStatus === 'success' ? 'text-emerald-600' :
                scanStatus === 'scanning' ? 'text-blue-600 animate-pulse' :
                'text-gray-600'
              }`}>
                {scanMessage}
              </p>
            </div>
            
            {scanStatus === 'idle' && (
              <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end">
                <button 
                  onClick={() => setBiometricModal({ isOpen: false, restaurantId: null })}
                  className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors"
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