/**
 * Fund My Meal - Secure Node.js Backend
 * --------------------------------------
 * Updated with Root and Health routes to fix "Cannot GET /"
 * Serves React frontend static files + API
 */

console.log('SERVER STARTING...');
require('dotenv').config();
console.log('Dotenv loaded');
const express = require('express');
console.log('Express loaded');
const cors = require('cors');
const path = require('path');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin
let db = null;
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
  db = admin.firestore();
  console.log('Firebase initialized successfully');
} catch (error) {
  console.warn('Firebase initialization failed:', error.message);
  console.warn('App will run without Firebase functionality');
}

const app = express();

// Configure CORS to allow your frontend
const origin = process.env.ORIGIN || '*';
app.use(cors({
  origin: origin,
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

// --- SERVE REACT STATIC FILES ---
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDistPath, {
  // Cache static assets
  maxAge: '1d',
  etag: false
}));

// --- HEALTH CHECK ROUTE ---
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- RESTAURANT ROUTES ---
app.post('/api/restaurants/register', async (req, res) => {
  const { name, description, initialFunds, ownerId } = req.body;
  if (!name || !ownerId) return res.status(400).json({ error: "Missing required fields" });

  try {
    const restRef = db.collection('artifacts').doc('fund-my-meal-v1')
      .collection('public').doc('data').collection('restaurants').doc();

    await restRef.set({
      name,
      description: description || '',
      funds: Number(initialFunds) || 0,
      mealsServed: 0,
      ownerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: restRef.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/restaurants/donate', async (req, res) => {
  const { restaurantId, amount, donorId } = req.body;
  if (!restaurantId || !amount || !donorId) return res.status(400).json({ error: "Missing required fields" });

  try {
    const restRef = db.collection('artifacts').doc('fund-my-meal-v1')
      .collection('public').doc('data').collection('restaurants').doc(restaurantId);

    await db.runTransaction(async (t) => {
      const restDoc = await t.get(restRef);
      if (!restDoc.exists) throw new Error('Restaurant not found');

      const currentFunds = restDoc.data().funds || 0;
      t.update(restRef, { funds: currentFunds + Number(amount) });
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- EXISTING WEBAUTHN ROUTES ---

// --- EXISTING WEBAUTHN ROUTES (Replaced with Custom Biometric Simulation) ---

app.post('/api/auth/register-biometric', async (req, res) => {
  const { userId, biometricKey } = req.body;
  if (!userId || !biometricKey) return res.status(400).json({ error: "Missing required fields" });

  try {
    await db.collection('users').doc(userId).set({
      id: userId,
      biometricKey: biometricKey,
      enrolledAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/verify-and-claim', async (req, res) => {
  const { userId, restaurantId, biometricKey, amount } = req.body;

  if (!userId || !restaurantId || !biometricKey || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const claimAmount = Number(amount);
  if (isNaN(claimAmount) || claimAmount < 1 || claimAmount > 20) {
    return res.status(400).json({ error: 'Invalid claim amount. Must be between $1 and $20.' });
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not registered. Please register your thumbprint first.' });
    }

    const user = userDoc.data();

    // Verify biometric hash exactly matches
    if (user.biometricKey !== biometricKey) {
      return res.status(401).json({ error: 'Biometric verification failed. Thumbprint mismatch.' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Check for 1 claim per day rule
    if (user.lastClaimDate === today) {
      return res.status(403).json({ error: 'You have already claimed a meal today. Limit 1 per day.' });
    }

    const restRef = db.collection('artifacts').doc('fund-my-meal-v1').collection('public').doc('data').collection('restaurants').doc(restaurantId);

    await db.runTransaction(async (t) => {
      const restDoc = await t.get(restRef);
      if (!restDoc.exists) throw new Error('Restaurant not found');

      const currentFunds = restDoc.data().funds || 0;
      if (currentFunds < claimAmount) throw new Error('Insufficient funds');

      t.update(restRef, {
        funds: currentFunds - claimAmount,
        mealsServed: (restDoc.data().mealsServed || 0) + 1
      });

      t.set(db.collection('artifacts').doc('fund-my-meal-v1').collection('public').doc('data').collection('transactions').doc(), {
        userId, restaurantId, amount: claimAmount, date: today, timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      t.update(userRef, { lastClaimDate: today });
    });

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// --- FALLBACK TO REACT APP (SPA routing) ---
// Serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Change the bottom of your file to this:
const PORT = process.env.PORT || 8080;
console.log('About to start listening on port', PORT);
app.listen(PORT, () => {
  console.log(`✅ SERVER RUNNING on port ${PORT}`);
});