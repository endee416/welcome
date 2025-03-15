require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.json());

// Initialize Firebase Admin using service account JSON
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();
const db = admin.firestore();

// Configure Nodemailer (Hostinger SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,         // e.g., smtp.hostinger.com
  port: Number(process.env.SMTP_PORT), // 465 (SSL) or 587 (TLS)
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Step-by-step approach:
 * 1) Generate a valid Firebase link with a dummy or your whitelisted HTTPS domain.
 * 2) Extract the `oobCode`.
 * 3) Build an HTTPS link that leads to your "open.html?oobCode=XYZ".
 * 4) In open.html, redirect to `schoolchow://verifyEmail?oobCode=XYZ`.
 */

// Generates a normal link using an HTTPS domain you own (and have whitelisted).
async function generateVerificationLinkWithHTTPS(email) {
  const dummyUrl = process.env.DUMMY_CONTINUE_URL || "https://schoolchow.com/placeholder";
  const actionCodeSettings = {
    url: dummyUrl,    // Must be whitelisted in Firebase 
    handleCodeInApp: true,
  };

  // Generate the official Firebase link
  const officialLink = await auth.generateEmailVerificationLink(email, actionCodeSettings);
  
  // Extract the oobCode from officialLink
  const oobCode = extractOobCode(officialLink);
  if (!oobCode) {
    throw new Error("Failed to extract oobCode from the official link.");
  }

  // Return an HTTPS link to your "open.html" with the oobCode as a query param
  // e.g. https://schoolchow.com/open.html?oobCode=XYZ
  return `https://schoolchow.com/open.html?oobCode=${oobCode}`;
}

// Helper to extract oobCode from generated link
function extractOobCode(link) {
  const parts = link.split('?');
  if (parts.length < 2) return null;
  const qs = new URLSearchParams(parts[1]);
  return qs.get('oobCode');
}

// Your custom email template
function getVerificationEmailTemplate(redirectLink, username) {
  const currentYear = new Date().getFullYear();
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
      .footer { font-size: 12px; text-align: center; color: #999; padding: 15px 0; }
      @media (max-width: 600px) {
        .content h1 { font-size: 2rem; }
        .content p { font-size: 1rem; }
      }
    </style>
    <!-- Kadwa font (if you want) -->
    <link href="https://fonts.googleapis.com/css2?family=Kadwa&display=swap" rel="stylesheet">
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://example.com/school-chow-logo.png" alt="">
      </div>
      <div class="content">
        <h1>Welcome to School Chow, ${username}!</h1>
        <p>
          Thank you for signing up. Click the button below to verify your email and start enjoying the best food deals for students.
        </p>
        <a class="button" href="${redirectLink}">Verify Email</a>
        <p>If the button doesn't work, copy and paste the link below into your browser:</p>
        <p><a href="${redirectLink}">${redirectLink}</a></p>
      </div>
      <div class="footer">
        &copy; ${currentYear} School Chow. All rights reserved.
      </div>
    </div>
  </body>
  </html>
  `;
}

// If user is unverified, delete from Auth and Firestore
async function deleteUnverifiedUser(user) {
  if (!user) return;
  try {
    const snapshot = await db.collection('users').where('uid', '==', user.uid).get();
    if (!snapshot.empty) {
      snapshot.forEach(async doc => {
        await doc.ref.delete();
        console.log(`Deleted Firestore entry for uid: ${user.uid}`);
      });
    }
    await auth.deleteUser(user.uid);
    console.log(`Deleted unverified user: ${user.email}`);
  } catch (error) {
    console.error("Error deleting unverified user:", error);
  }
}

//================== Regular User Registration ==================//
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
    if (existingUser && !existingUser.emailVerified) {
      await deleteUnverifiedUser(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }

    // Create new user
    const userRecord = await auth.createUser({ email, password, displayName: username });

    // Generate an HTTPS link that leads to "open.html?oobCode=XYZ"
    const redirectLink = await generateVerificationLinkWithHTTPS(email);

    // Build the HTML with that link
    const emailHTML = getVerificationEmailTemplate(redirectLink, username);

    // Send via Nodemailer
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });

    // Add Firestore doc
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

//================== Vendor Registration ==================//
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
      await deleteUnverifiedUser(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }

    // Create new vendor user
    const userRecord = await auth.createUser({ email, password, displayName: firstname });

    // Generate link -> "https://schoolchow.com/open.html?oobCode=XYZ"
    const redirectLink = await generateVerificationLinkWithHTTPS(email);

    // Email HTML
    const emailHTML = getVerificationEmailTemplate(redirectLink, firstname);

    // Send
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });

    // Add vendor doc
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

    res.status(200).json({ message: 'Vendor registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Vendor registration error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
