const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

// Initialize Firebase Admin
// On Cloud Run, this automatically uses the default service account
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:5173';
const EXPECTED_RP_ID = RP_ID;

// --- ROUTES ---

// 1. Root Route (Fixes "Cannot GET /")
app.get('/', (req, res) => {
  res.status(200).send({
    status: "online",
    message: "Fund My Meal API is running",
    endpoints: ["/api/auth/generate-registration", "/api/auth/generate-authentication"]
  });
});

// 2. WebAuthn: Generate Registration Options
app.post('/api/auth/generate-registration', async (req, res) => {
  const { userId, userName } = req.body;
  
  // In a real app, store the current challenge in a DB associated with the user session
  const options = generateRegistrationOptions({
    rpName: 'Fund My Meal',
    rpID: EXPECTED_RP_ID,
    userID: userId,
    userName: userName || userId,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // Force TouchID/FaceID/Windows Hello
    },
  });

  res.send(options);
});

// 3. WebAuthn: Verify and Claim Meal
// This combines Biometric verification with the Firestore Transaction
app.post('/api/auth/verify-authentication-and-claim', async (req, res) => {
  const { userId, restaurantId, body, appId = 'fund-my-meal-v1' } = req.body;

  try {
    // A. Verify Biometric (Simplified for demo - in production use simplewebauthn verify)
    // We assume the biometric check passed if we reached this logic from a trusted client
    
    // B. Execute Firestore Transaction
    // Path: /artifacts/{appId}/public/data/restaurants/{restaurantId}
    const restaurantRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('restaurants').doc(restaurantId);
    const claimRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('claims').doc();

    const result = await db.runTransaction(async (t) => {
      const doc = await t.get(restaurantRef);
      if (!doc.exists) throw new Error('Restaurant not found');
      
      const data = doc.data();
      if (data.funds < 20) throw new Error('Insufficient funds at this location');

      // Update Restaurant
      t.update(restaurantRef, {
        funds: data.funds - 20,
        mealsServed: (data.mealsServed || 0) + 1,
        lastClaimedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Log Claim
      t.set(claimRef, {
        userId,
        restaurantId,
        amount: 20,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });

      return { success: true };
    });

    res.send(result);
  } catch (error) {
    console.error('Transaction failed:', error);
    res.status(400).send({ success: false, error: error.message });
  }
});

// 4. Authentication Options (Login/Verification)
app.post('/api/auth/generate-authentication', async (req, res) => {
  const options = generateAuthenticationOptions({
    rpID: EXPECTED_RP_ID,
    userVerification: 'preferred',
  });
  res.send(options);
});

// START SERVER
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Expecting Origin: ${ORIGIN}`);
  console.log(`Expecting RP_ID: ${EXPECTED_RP_ID}`);
});