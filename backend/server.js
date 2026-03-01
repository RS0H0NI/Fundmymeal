/**
 * Fund My Meal - Secure Node.js Backend
 * --------------------------------------
 * This file handles secure biometric verification and 
 * server-side Firestore updates.
 */

require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const { 
  generateRegistrationOptions, 
  verifyRegistrationResponse, 
  generateAuthenticationOptions, 
  verifyAuthenticationResponse 
} = require('@simplewebauthn/server');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin
// If deploying to Cloud Run, it will use the default service account automatically.
// For local use, ensure GOOGLE_APPLICATION_CREDENTIALS points to your JSON key.
admin.initializeApp({
  credential: admin.credential.applicationDefault() 
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// 2. Configuration from Environment Variables
const rpName = process.env.RP_NAME || 'Fund My Meal';
const rpID = process.env.RP_ID || 'localhost';
const origin = process.env.ORIGIN || 'http://localhost:5173';

/**
 * STEP 1: DEVICE ENROLLMENT (REGISTRATION)
 * Used to link a user's fingerprint/FaceID to their account.
 */
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

/**
 * STEP 2: CLAIMING A MEAL (AUTHENTICATION)
 * This verifies the fingerprint and deducts funds in one secure step.
 */
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

    // Secure Firestore Transaction
    // This happens server-side so it cannot be intercepted or faked.
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
      
      // Log the transaction for transparency
      t.set(db.collection('transactions').doc(), {
        userId, restaurantId, amount: 20, date: today, timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Secure Backend running on port ${PORT}`);
});