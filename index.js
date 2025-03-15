require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.json());

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();
const db = admin.firestore();

// Nodemailer with Hostinger
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/** Generate the standard HTTPS verification link with a lowercase "/verifyemail" path */
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    // Must be whitelisted in Firebase
    url: "https://schoolchow.com/verifyemail", 
    handleCodeInApp: false,
  };
  return auth.generateEmailVerificationLink(email, actionCodeSettings);
}

/** Fun, single-button verification email with your logo from "schoolchow.com/verifyemail/logo.png" */
function getVerificationEmailTemplate(verificationLink, username) {
  const currentYear = new Date().getFullYear();
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Verify Your Email - School Chow</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Kadwa&display=swap');
      
      body {
        margin: 0;
        padding: 0;
        background-color: #f7f7f7;
        font-family: 'Kadwa', sans-serif;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background: #fff;
        border-radius: 8px;
        overflow: hidden;
        font-size: 16px;
        line-height: 1.6;
        color: #333;
      }
      .header {
        text-align: center;
        padding: 20px;
      }
      .header img {
        max-width: 150px;
        display: block;
        margin: 0 auto;
      }
      .content {
        padding: 20px;
        text-align: center;
      }
      .content h1 {
        font-size: 2.5rem;
        margin-bottom: 0.5em;
        color: #333;
      }
      .content p {
        margin: 0 auto;
        margin-bottom: 1em;
        max-width: 500px;
      }
      .button {
        background-color: #0c513f;
        color: #fff;
        padding: 14px 24px;
        border-radius: 5px;
        text-decoration: none;
        display: inline-block;
        margin: 20px 0;
        font-size: 16px;
      }
      .footer {
        font-size: 12px;
        text-align: center;
        color: #999;
        padding: 15px 0;
      }
      @media (max-width: 600px) {
        .content h1 { font-size: 2rem; }
        body {
          font-size: 14px;
        }
        .button {
          font-size: 14px;
          padding: 12px 18px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <!-- Use your requested logo URL -->
        <img src="https://schoolchow.com/verifyemail/logo.png" alt="School Chow Logo">
      </div>
      <div class="content">
        <h1>Welcome to School Chow, ${username}!</h1>
        <p>
          Thanks for joining our student foodie community! We’ve got
          mouthwatering deals and fresh bites just for you. Before you
          dive into the tastiness, let’s make sure your email is all set.
        </p>
        <p>
          Tap the button below to verify your email and start feasting on
          the best meal offers in town.
        </p>
        <a class="button" href="${verificationLink}">Verify Email</a>
        <p><em>We can’t wait to serve you!</em></p>
      </div>
      <div class="footer">
        &copy; ${currentYear} School Chow. All rights reserved.
      </div>
    </div>
  </body>
  </html>
  `;
}

async function deleteUnverifiedUser(user) {
  if (!user) return;
  try {
    const snapshot = await db.collection('users').where('uid', '==', user.uid).get();
    if (!snapshot.empty) {
      snapshot.forEach(async (doc) => {
        await doc.ref.delete();
        console.log(`Deleted Firestore entry for uid: ${user.uid}`);
      });
    }
    await auth.deleteUser(user.uid);
    console.log(`Deleted unverified user: ${user.email}`);
  } catch (error) {
    console.error("Error deleting user account:", error);
    throw error;
  }
}

// ================ Rider Registration Endpoint ===================== //
app.post('/rider/register', async (req, res) => {
  const { email, password, phoneno, surname, firstname, school, address } = req.body;
  if (!email || !password || !phoneno || !surname || !firstname || !school || !address) {
    return res.status(400).json({ error: 'Please fill in all fields' });
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

    // Create new user with role: driver
    const userRecord = await auth.createUser({ email, password, displayName: firstname });

    // Generate the standard HTTPS verification link
    const verificationLink = await generateVerificationLink(email);

    // Build the fun HTML email
    const emailHTML = getVerificationEmailTemplate(verificationLink, firstname);

    // Send the email
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });

    // Add user doc in Firestore
    const docRef = await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'driver', // same role you mentioned in createUserWithEmailAndPassword
      phoneno,
      surname,
      firstname,
      school,
      address,
      balance: 0,
    });

    res.status(200).json({ message: 'User registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Rider registration error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ================ Other Endpoints ================ //
// (Add your /register, /vendor/register, etc., exactly as you do with standard HTTPS flow)

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
