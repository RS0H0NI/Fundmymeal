/**
 * Fund My Meal - Secure Node.js Backend
 * --------------------------------------
 * Updated with Root and Health routes to fix "Cannot GET /"
 * Serves React frontend static files + API
 */

require('dotenv').config(); 
const express = require('express');
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

// --- EXISTING WEBAUTHN ROUTES ---

const rpName = process.env.RP_NAME || 'Fund My Meal';
const rpID = process.env.RP_ID || 'localhost';

app.get('/api/auth/generate-registration', async (req, res) => {
  try {
    const userId = `usr_${Math.random().toString(36).substring(2, 9)}`;
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: userId,
      userName: `recipient_${userId}@fundmymeal.app`,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    await db.collection('challenges').doc(userId).set({
      challenge: options.challenge,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ options, userId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/verify-registration', async (req, res) => {
  const { userId, response } = req.body;
  const challengeDoc = await db.collection('challenges').doc(userId).get();
  
  if (!challengeDoc.exists) return res.status(400).json({ error: "Challenge expired" });
  
  const expectedChallenge = challengeDoc.data().challenge;

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (verification.verified) {
      const { registrationInfo } = verification;
      await db.collection('users').doc(userId).set({
        id: userId,
        credentialID: Buffer.from(registrationInfo.credentialID).toString('base64'),
        credentialPublicKey: Buffer.from(registrationInfo.credentialPublicKey).toString('base64'),
        counter: registrationInfo.counter,
        enrolledAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ success: true });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/generate-authentication', async (req, res) => {
  const { userId } = req.body;
  const userDoc = await db.collection('users').doc(userId).get();
  
  if (!userDoc.exists) return res.status(404).json({ error: 'User not enrolled' });
  const user = userDoc.data();

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{
      id: Buffer.from(user.credentialID, 'base64'),
      type: 'public-key',
    }],
    userVerification: 'required',
  });

  await db.collection('challenges').doc(userId).set({ challenge: options.challenge });
  res.json(options);
});

app.post('/api/auth/verify-authentication-and-claim', async (req, res) => {
  const { userId, response, restaurantId } = req.body;
  
  const userDoc = await db.collection('users').doc(userId).get();
  const challengeDoc = await db.collection('challenges').doc(userId).get();
  
  if (!userDoc.exists || !challengeDoc.exists) {
    return res.status(400).json({ error: 'Invalid session' });
  }

  const user = userDoc.data();

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeDoc.data().challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialPublicKey: Buffer.from(user.credentialPublicKey, 'base64'),
        credentialID: Buffer.from(user.credentialID, 'base64'),
        counter: user.counter,
      },
    });

    if (!verification.verified) throw new Error('Unauthorized');

    const today = new Date().toISOString().split('T')[0];
    const restRef = db.collection('restaurants').doc(restaurantId);
    
    await db.runTransaction(async (t) => {
      const restDoc = await t.get(restRef);
      if (!restDoc.exists) throw new Error('Restaurant not found');
      
      const currentFunds = restDoc.data().funds;
      if (currentFunds < 20) throw new Error('Insufficient funds');

      t.update(restRef, { 
        funds: currentFunds - 20,
        mealsServed: (restDoc.data().mealsServed || 0) + 1
      });
      
      t.set(db.collection('transactions').doc(), {
        userId, restaurantId, amount: 20, date: today, timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
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
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Local server listening on port ${PORT}`);
  });
}

module.exports = app; // CRITICAL FOR VERCEL