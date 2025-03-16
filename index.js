require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

// 1) Initialize Firebase Admin using the service account from env
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();
const db = admin.firestore();

// 2) Configure Nodemailer (Hostinger SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,         // e.g., smtp.hostinger.com
  port: Number(process.env.SMTP_PORT),   // e.g., 465 (SSL) or 587 (TLS)
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 3) Helper: Generate a Firebase verification link for email verification
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    url: process.env.VERIFICATION_CONTINUE_URL || "https://schoolchow.com/verifyemail",
    handleCodeInApp: false, // standard HTTPS redirect
  };
  const link = await auth.generateEmailVerificationLink(email, actionCodeSettings);
  console.log("Generated Verification Link:", link);
  return link;
}

// 4) Helper: Generate a Firebase password reset link
async function generatePasswordResetLink(email) {
  const actionCodeSettings = {
    url: process.env.PASSWORD_RESET_CONTINUE_URL || "https://schoolchow.com/resetpassword",
    handleCodeInApp: false,
  };
  const link = await auth.generatePasswordResetLink(email, actionCodeSettings);
  console.log("Generated Password Reset Link:", link);
  return link;
}

// 5) Helper: HTML Email Template for Verification (Rider-style design)
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
      .header { text-align: center; padding: 20px; background-color: #0c513f; }
      .header img { max-width: 150px; display: block; margin: 0 auto; }
      .content { padding: 30px; text-align: center; }
      .content h1 { font-size: 2.5rem; margin-bottom: 0.5em; color: #0c513f; }
      .content p { font-size: 1.2rem; line-height: 1.6; color: #444; }
      .button { background-color: #0c513f; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
      .footer { background: #eee; padding: 15px; text-align: center; font-size: 12px; color: #888; }
      @media (max-width: 600px) {
        .content h1 { font-size: 2rem; }
        .content p { font-size: 1rem; }
      }
    </style>
    <link href="https://fonts.googleapis.com/css2?family=Kadwa&display=swap" rel="stylesheet">
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://schoolchow.com/verifyemail/logo.png" alt="">
      </div>
      <div class="content">
        <h1>Welcome to School Chow, ${username}!</h1>
        <p>
          You’re this close 🤏 to unlocking the tastiest student discounts, the fastest food deliveries, and the best local eats! But first, let’s make sure it’s really you.
        </p>
        <a class="button" href="${verificationLink}">Verify Email</a>
      </div>
      <div class="footer">
        &copy; 2025 School Chow. All rights reserved.
      </div>
    </div>
  </body>
  </html>
  `;
}

// 6) Helper: HTML Email Template for Password Reset
function getPasswordResetEmailTemplate(resetLink, username) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Reset Your Password - School Chow</title>
    <style>
      body { font-family: 'Kadwa', sans-serif; margin: 0; padding: 0; background-color: #f7f7f7; }
      .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
      .header { text-align: center; padding: 20px; background-color: #0c513f; }
      .header img { max-width: 150px; display: block; margin: 0 auto; }
      .content { padding: 30px; text-align: center; }
      .content h1 { font-size: 2.5rem; margin-bottom: 0.5em; color: #0c513f; }
      .content p { font-size: 1.2rem; line-height: 1.6; color: #444; }
      .button { background-color: #0c513f; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 20px 0; }
      .footer { background: #eee; padding: 15px; text-align: center; font-size: 12px; color: #888; }
      @media (max-width: 600px) {
        .content h1 { font-size: 2rem; }
        .content p { font-size: 1rem; }
      }
    </style>
    <link href="https://fonts.googleapis.com/css2?family=Kadwa&display=swap" rel="stylesheet">
  </head>
  <body>
    <div class="container">
      <div class="header">
        <img src="https://schoolchow.com/verifyemail/logo.png" alt="">
      </div>
      <div class="content">
        <h1>Reset Your Password!</h1>
        <p>
          It looks like you requested a password reset. Click the button below to reset your password.
        </p>
        <a class="button" href="${resetLink}">Reset Password</a>
      </div>
      <div class="footer">
        &copy; 2025 School Chow. All rights reserved.
      </div>
    </div>
  </body>
  </html>
  `;
}

// 7) Helper: Delete unverified user and their Firestore docs
async function deleteUserAccount(user) {
  if (!user) return;
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('uid', '==', user.uid).get();
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

// 8) Register a regular user
app.post('/register', async (req, res) => {
  const { email, password, username, surname, phoneno, school } = req.body;
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
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }
    const userRecord = await auth.createUser({ email, password, displayName: username });
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'regular_user',
      firstname: username,
      surname: surname || "",
      phoneno: phoneno || "",
      school: school || "",
      ordernumber: 0,
      totalorder: 0,
      debt: 0,
    });
    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, username);
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });
    res.status(200).json({ message: 'User registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('User registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 9) Register a vendor
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
    const userRecord = await auth.createUser({ email, password, displayName: firstname });
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
    res.status(500).json({ error: error.message });
  }
});

// 10) Register a rider
app.post('/rider/register', async (req, res) => {
  const { email, password, phoneno, surname, firstname, school, address } = req.body;
  if (!email || !password || !phoneno || !surname || !firstname || !school || !address) {
    return res.status(400).json({ error: 'Please fill in all fields for rider registration.' });
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
    const userRecord = await auth.createUser({ email, password });
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'rider',
      phoneno,
      surname,
      firstname,
      school,
      address,
      balance: 0,
    });
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
    res.status(500).json({ error: error.message });
  }
});

// 11) Forgot Password Endpoint
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Please provide your email address.' });
  }
  try {
    // Ensure user exists and is verified
    const user = await auth.getUserByEmail(email);
    if (!user.emailVerified) {
      return res.status(400).json({ error: 'Your email is not verified. Please verify your email before resetting your password.' });
    }
    const resetLink = await auth.generatePasswordResetLink(email, {
      url: process.env.PASSWORD_RESET_CONTINUE_URL || "https://schoolchow.com/resetpassword",
      handleCodeInApp: false,
    });
    console.log("Generated Password Reset Link:", resetLink);
    // Send password reset email using a custom template
    const resetEmailHTML = getPasswordResetEmailTemplate(resetLink, user.displayName || "User");
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Reset Your Password - School Chow',
      html: resetEmailHTML,
    });
    res.status(200).json({ message: 'Password reset email sent successfully.' });
  } catch (error) {
    console.error("Forgot password error:", error);
    if (error.code === "auth/invalid-email") {
      return res.status(400).json({ error: "The email address is improperly formatted." });
    } else if (error.code === "auth/user-not-found") {
      return res.status(400).json({ error: "No user found with this email address." });
    } else {
      return res.status(500).json({ error: error.message });
    }
  }
});

// 12) Delete Unverified User Endpoint
app.delete("/delete-unverified", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "No email provided." });
    }
    const user = await auth.getUserByEmail(email);
    if (user.emailVerified) {
      return res.status(400).json({ message: "User is already verified." });
    }
    await auth.deleteUser(user.uid);
    const snapshot = await db.collection("users").where("uid", "==", user.uid).get();
    snapshot.forEach((doc) => doc.ref.delete());
    res.status(200).json({ message: "Deleted unverified user successfully." });
  } catch (error) {
    console.error("Error deleting unverified user:", error);
    res.status(500).json({ error: error.message });
  }
});

// 13) Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
