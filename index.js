// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.json());

// Initialize Firebase Admin SDK using your service account JSON stored in an environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();
const db = admin.firestore();

// Configure Nodemailer with your Hostinger SMTP settings.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,         // e.g., smtp.hostinger.com
  port: Number(process.env.SMTP_PORT),   // e.g., 465 for SSL, or 587 for TLS
  secure: Number(process.env.SMTP_PORT) === 465, // true if port 465 (SSL), false otherwise
  auth: {
    user: process.env.SMTP_USER,         // your custom email address
    pass: process.env.SMTP_PASS,
  },
});

// Generate a verification link using Firebase Admin SDK with handleCodeInApp: false
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    // Ensure this is an HTTPS URL; no custom scheme is allowed unless using Dynamic Links.
    url: process.env.VERIFICATION_CONTINUE_URL || "https://schoolchow.com/verifyemail",
    handleCodeInApp: false, 
  };
  return auth.generateEmailVerificationLink(email, actionCodeSettings);
}

// Custom HTML email template for School Chow
function getVerificationEmailTemplate(verificationLink, username) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Verify Your Email - School Chow</title>
    <style>
      body { font-family: 'Kadwa', sans-serif; margin: 0; padding: 0; background-color: #f7f7f7; }
      .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
      .header { text-align: center; background-color: #fff; padding: 20px; }
      .header img { max-width: 150px; display: block; margin: 0 auto; }
      .content { padding: 20px; text-align: center; }
      .content h1 { font-size: 2.5rem; margin-bottom: 0.5em; }
      .content p { font-size: 1.2rem; line-height: 1.6; }
      .button { background-color: #0c513f; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
      @media (max-width: 600px) {
        .content h1 { font-size: 2rem; }
        .content p { font-size: 1rem; }
      }
    </style>
    <!-- Optional: load Kadwa font -->
    <link href="https://fonts.googleapis.com/css2?family=Kadwa&display=swap" rel="stylesheet">
  </head>
  <body>
    <div class="container">
      <div class="header">
        <!-- The alt attribute is empty to avoid any label before the logo -->
        <img src="https://example.com/school-chow-logo.png" alt="">
      </div>
      <div class="content">
        <h1>Welcome to School Chow, ${username}!</h1>
        <p>
          Thank you for signing up. Click the button below to verify your email and start enjoying the best food deals for students.
        </p>
        <a class="button" href="${verificationLink}">Verify Email</a>
        <p>
          If the button doesn't work, copy and paste the link below into your browser:
        </p>
        <p><a href="${verificationLink}">${verificationLink}</a></p>
      </div>
    </div>
  </body>
  </html>
  `;
}

// Delete user from Firebase Authentication and also remove Firestore documents where uid field matches.
async function deleteUserAccount(user) {
  if (!user) return;

  try {
    // Query the Firestore "users" collection for documents with uid field matching the user's uid
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('uid', '==', user.uid).get();
    if (!snapshot.empty) {
      snapshot.forEach(async (doc) => {
        await doc.ref.delete();
        console.log(`Deleted Firestore entry for uid: ${user.uid}`);
      });
    }
    // Delete user from Firebase Auth
    await auth.deleteUser(user.uid);
    console.log(`Deleted unverified user from Auth: ${user.email}`);
  } catch (error) {
    console.error("Error deleting user account:", error);
    throw error;
  }
}

// Registration endpoint
app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Please provide email, password, and username.' });
  }
  try {
    // Check if user exists
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    // If user exists and is not verified, delete both Auth record and Firestore entry
    if (existingUser && !existingUser.emailVerified) {
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }

    // Create new user
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: username,
    });

    // Generate verification link
    const verificationLink = await generateVerificationLink(email);
    // Create custom HTML email
    const emailHTML = getVerificationEmailTemplate(verificationLink, username);
    // Send email via Nodemailer
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });

    // Also add the user to Firestore "users" collection
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      firstname: username,
      role: 'regular_user',
      ordernumber: 0,
      totalorder: 0,
      debt: 0,
    });

    res.status(200).json({ message: 'User registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start the server on Railway's provided PORT or default to 3000 (Railway sets process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
