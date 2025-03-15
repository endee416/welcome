// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

// 1) Create Express app
const app = express();
app.use(bodyParser.json());

// 2) Initialize Firebase Admin using service account from env
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();
const db = admin.firestore();

// 3) Configure Nodemailer (Hostinger SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,         // e.g., smtp.hostinger.com
  port: Number(process.env.SMTP_PORT), // 465 for SSL or 587 for TLS
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 4) Helper: Generate a Firebase verification link (handleCodeInApp = true)
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    // If you prefer a simple redirect, set handleCodeInApp: false
    url: process.env.VERIFICATION_CONTINUE_URL || "https://schoolchow.com/verifyemail",
    handleCodeInApp: false, 
  };
  const link = await auth.generateEmailVerificationLink(email, actionCodeSettings);
  console.log("Generated Verification Link:", link);
  return link;
}

// 5) Helper: HTML Email Template (unchanged from your snippet)
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
      .header { text-align: center; padding: 20px; }
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
    <!-- Kadwa font -->
    <link href="https://fonts.googleapis.com/css2?family=Kadwa&display=swap" rel="stylesheet">
  </head>
  <body>
    <div class="container">
      <div class="header">
        <!-- If you have a real School Chow logo, update the src below -->
        <img src="https://example.com/school-chow-logo.png" alt="">
      </div>
      <div class="content">
        <h1>Welcome to School Chow, ${username}!</h1>
        <p>
          You’re this close 🤏 to unlocking the tastiest student discounts, the fastest food deliveries, and the best local eats! But first, let’s make sure it’s really you.
        </p>
        
      </div>
       <div style="background:#eee; padding:15px; text-align:center; font-size:12px; color:#888;">
      &copy; 2025 School Chow. All rights reserved.
    </div>
    </div>
  </body>
  </html>
  `;
}

// 6) Helper: Delete unverified user + Firestore docs
async function deleteUserAccount(user) {
  if (!user) return;
  try {
    // Remove user doc(s) from Firestore
    const snapshot = await db.collection('users').where('uid', '==', user.uid).get();
    if (!snapshot.empty) {
      snapshot.forEach(async (doc) => {
        await doc.ref.delete();
        console.log(`Deleted Firestore entry for uid: ${user.uid}`);
      });
    }
    // Delete user from Firebase Auth
    await auth.deleteUser(user.uid);
    console.log(`Deleted unverified user: ${user.email}`);
  } catch (error) {
    console.error("Error deleting user account:", error);
    throw error;
  }
}

// 7) Register a "regular user" (just like your snippet)
app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Please provide email, password, and username.' });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    // If unverified user exists, delete them
    if (existingUser && !existingUser.emailVerified) {
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }

    // Create new user in Auth
    const userRecord = await auth.createUser({ email, password, displayName: username });

    // Send verification email
    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, username);
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });

    // Add user doc
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'regular_user',
      firstname: username,
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

// 8) Register a vendor (just like your snippet)
app.post('/vendor/register', async (req, res) => {
  const { email, password, phoneno, surname, firstname, businessname, businessCategory, selectedSchool, address, profilepic } = req.body;

  if (!email || !password || !phoneno || !surname || !firstname || !businessname || !businessCategory || !selectedSchool || !address || !profilepic) {
    return res.status(400).json({ error: 'Please fill in all fields for vendor registration.' });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    if (existingUser && !existingUser.emailVerified) {
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }

    // Create new vendor in Auth
    const userRecord = await auth.createUser({ email, password, displayName: firstname });

    // Add vendor doc to Firestore
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'vendor',
      phoneno,
      surname,
      firstname,
      profilepic,
      school: selectedSchool,
      address,
      businessname,
      businesscategory: businessCategory,
      now: 'open',
      balance: 0,
    });

    // Send verification email
    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, firstname);
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });

    res.status(200).json({ message: 'Vendor registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Vendor registration error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 9) Register a rider
app.post('/rider/register', async (req, res) => {
  const { email, password, phoneno, surname, firstname, school, address } = req.body;

  // The snippet you gave shows all fields are required:
  // if (!email || !password || !phoneno || !surname || !firstname || !selectedSchool || !address) ...
  // but let's match the snippet precisely:
  if (!email || !password || !phoneno || !surname || !firstname || !school || !address) {
    return res.status(400).json({ error: 'Please fill in all fields' });
  }
  try {
    // Check existing user
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    if (existingUser && !existingUser.emailVerified) {
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }

    // Create new rider in Auth
    const userRecord = await auth.createUser({ email, password });

    // Add rider doc
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'driver',  // or "driver" if you prefer
      phoneno,
      surname,
      firstname,
      school,
      address,
      balance: 0,
    });

    // Send verification email
    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, firstname);
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });

    res.status(200).json({ message: 'Rider registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Rider registration error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// 10) Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
