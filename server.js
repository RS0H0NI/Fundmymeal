/**
 * Fund My Meal - Secure Node.js Backend
 * --------------------------------------
 * This server handles the biometric WebAuthn verification and securely 
 * updates the Firestore ledger. By moving this logic here, malicious users 
 * cannot hack the frontend to give themselves unlimited meals.
 * * Dependencies to install in your real repo:
 * npm install express cors dotenv firebase-admin @simplewebauthn/server
 */

const express = require('express');
const cors = require('cors');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin (Server-side)
// In production, these credentials come from Google Cloud Secret Manager
admin.initializeApp({
  credential: admin.credential.applicationDefault() 
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// 2. WebAuthn Relying Party (RP) Configuration
// This tells the phone's security chip who is asking for the fingerprint.
const rpName = 'Fund My Meal';
const rpID = 'fundmymeal.app'; // Your actual domain in production
const origin = `https://${rpID}`;

/**
 * ==========================================
 * STEP 1: DEVICE ENROLLMENT (REGISTRATION)
 * ==========================================
 */

// Route 1A: The phone asks for a cryptographic puzzle to solve during enrollment
app.get('/api/auth/generate-registration', async (req, res) => {
  const userId = `usr_${Math.random().toString(36).substring(2, 9)}`;
  
  // Generate a random challenge that the phone must sign
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: userId,
    userName: `recipient_${userId}@fundmymeal.app`,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required', // Forces FaceID / TouchID
    },
  });

  // Temporarily store the challenge in the database so we can check the answer later
  await db.collection('challenges').doc(userId).set({
    challenge: options.challenge,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  res.json({ options, userId });
});

// Route 1B: The phone sends back the solved puzzle and its Public Key
app.post('/api/auth/verify-registration', async (req, res) => {
  const { userId, response } = req.body;

  // Get the original challenge we sent them
  const challengeDoc = await db.collection('challenges').doc(userId).get();
  const expectedChallenge = challengeDoc.data().challenge;

  let verification;
  try {
    // Verify the math! Does the signature match the challenge?
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  if (verification.verified) {
    // SUCCESS! Save the user's Public Key securely in Firestore.
    // Notice: We do NOT store a fingerprint. Only a long string of random math.
    const { registrationInfo } = verification;
    await db.collection('users').doc(userId).set({
      id: userId,
      credentialID: Buffer.from(registrationInfo.credentialID).toString('base64'),
      credentialPublicKey: Buffer.from(registrationInfo.credentialPublicKey).toString('base64'),
      counter: registrationInfo.counter,
      enrolledAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, message: 'Device securely enrolled.' });
  }
});

/**
 * ==========================================
 * STEP 2: CLAIMING A MEAL (AUTHENTICATION)
 * ==========================================
 */

// Route 2A: The phone asks for a puzzle to prove identity before claiming a meal
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

// Route 2B: The phone sends the signed puzzle to claim the meal
app.post('/api/auth/verify-authentication-and-claim', async (req, res) => {
  const { userId, response, restaurantId } = req.body;
  
  const userDoc = await db.collection('users').doc(userId).get();
  const user = userDoc.data();
  const challengeDoc = await db.collection('challenges').doc(userId).get();

  // 1. VERIFY BIOMETRICS
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
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
  } catch (error) {
    return res.status(400).json({ error: 'Biometric verification failed.' });
  }

  if (!verification.verified) return res.status(401).json({ error: 'Unauthorized' });

  // 2. RUN BUSINESS LOGIC ON THE SECURE SERVER
  const today = new Date().toISOString().split('T')[0];
  const txRef = db.collection('transactions');
  
  // Check Constraint 1: Has the user eaten today?
  const todayClaims = await txRef
    .where('userId', '==', userId)
    .where('date', '==', today)
    .where('status', '==', 'approved')
    .get();

  if (!todayClaims.empty) {
    await txRef.add({ userId, restaurantId, amount: 0, date: today, status: 'denied', reason: 'Daily limit reached' });
    return res.status(403).json({ error: 'Daily limit reached.' });
  }

  // Check Constraint 2: Does the restaurant have funds?
  // We use a Firestore Transaction to prevent "double spending" if two people claim at the exact same millisecond.
  const restRef = db.collection('restaurants').doc(restaurantId.toString());
  const mealCost = 20;

  try {
    await db.runTransaction(async (t) => {
      const restDoc = await t.get(restRef);
      if (!restDoc.exists) throw new Error('Restaurant not found');
      
      const currentFunds = restDoc.data().funds;
      if (currentFunds < mealCost) throw new Error('Insufficient restaurant funds');

      // Execute the deduction safely
      t.update(restRef, { 
        funds: currentFunds - mealCost,
        mealsServed: restDoc.data().mealsServed + 1
      });
      
      // Log the successful claim
      t.set(txRef.doc(), {
        userId, restaurantId, amount: mealCost, date: today, status: 'approved', timestamp: Date.now()
      });
    });

    res.json({ success: true, message: 'Meal claimed successfully!' });

  } catch (error) {
    await txRef.add({ userId, restaurantId, amount: 0, date: today, status: 'denied', reason: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Secure Fund My Meal backend running on port ${PORT}`);
});