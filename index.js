// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.json());

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();
const db = admin.firestore();

// Configure Nodemailer with Hostinger SMTP settings.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // e.g., smtp.hostinger.com
  port: Number(process.env.SMTP_PORT), // 465 for SSL or 587 for TLS
  secure: Number(process.env.SMTP_PORT) === 465, // true for port 465, false otherwise
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Helper: Upload image to Cloudinary (used for vendor registration)
// Assumes your vendor registration payload includes a "selectedImage" object with a URI
async function uploadImage(media) {
  if (!media || !media.uri) {
    throw new Error('No image provided');
  }
  const formData = new FormData();
  try {
    const response = await fetch(media.uri);
    const blob = await response.blob();

    // Append file details to formData. Adjust fileName and mimeType as needed.
    formData.append('file', {
      uri: media.uri,
      name: media.fileName || `upload.${media.mimeType ? media.mimeType.split("/")[1] : "jpg"}`,
      type: media.mimeType || "image/jpeg",
    });
    formData.append('upload_preset', 'Chownow2');
    formData.append('cloud_name', 'ddlubqotl');

    const uploadResponse = await fetch('https://api.cloudinary.com/v1_1/ddlubqotl/upload', {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': "application/json",
        // Let fetch set Content-Type with proper boundary when using formData.
      },
    });
    const responseJson = await uploadResponse.json();
    if (responseJson.error) {
      throw new Error(responseJson.error.message);
    }
    return responseJson; // Contains secure_url, etc.
  } catch (error) {
    console.error("Upload failed:", error);
    throw error;
  }
}

// Helper: Generate Firebase email verification link (using HTTPS and handleCodeInApp: false)
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    url: process.env.VERIFICATION_CONTINUE_URL || "https://schoolchow.com/verifyEmail",
    handleCodeInApp: false,
  };
  return auth.generateEmailVerificationLink(email, actionCodeSettings);
}

// Helper: Custom HTML email template for verification
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
    <link href="https://fonts.googleapis.com/css2?family=Kadwa&display=swap" rel="stylesheet">
  </head>
  <body>
    <div class="container">
      <div class="header">
        <!-- Remove label by setting alt="" -->
        <img src="https://schoolchow.com/verifyemail/logo.png" alt="">
      </div>
      <div class="content">
        <h1>Welcome to School Chow, ${username}!</h1>
        <p>
          Thanks for signing up! Click the button below to verify your email and start enjoying the best food deals for students.
        </p>
        <a class="button" href="${verificationLink}">Verify Email</a>
        <p>If the button doesn't work, copy and paste the link below into your browser:</p>
        <p><a href="${verificationLink}">${verificationLink}</a></p>
      </div>
    </div>
  </body>
  </html>
  `;
}

// Helper: Delete an existing unverified user and remove their Firestore document (where uid field equals user's uid)
async function deleteUserAccount(user) {
  if (!user) return;
  try {
    // Query Firestore "users" collection where field uid equals user.uid
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('uid', '==', user.uid).get();
    if (!snapshot.empty) {
      snapshot.forEach(async (doc) => {
        await doc.ref.delete();
        console.log(`Deleted Firestore entry for uid: ${user.uid}`);
      });
    }
    // Delete user from Firebase Authentication
    await auth.deleteUser(user.uid);
    console.log(`Deleted unverified user: ${user.email}`);
  } catch (error) {
    console.error("Error deleting user account:", error);
    throw error;
  }
}

// Endpoint for regular user registration
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
    // Generate verification link and send email
    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, username);
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });
    // Add user document to Firestore for regular user
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'regular_user',
      firstname: username,
      ordernumber: 0,
      totalorder: 0,
      debt: 0
    });
    res.status(200).json({ message: 'User registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Endpoint for vendor registration
app.post('/vendor/register', async (req, res) => {
  const { email, password, phoneno, surname, firstname, businessname, businessCategory, selectedSchool, address, selectedImage } = req.body;
  // Check required fields (for vendor, all fields including image must be provided)
  if (!email || !password || !phoneno || !surname || !firstname || !businessname || !businessCategory || !selectedSchool || !address || !selectedImage) {
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
    // Create new vendor user
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: firstname,
    });
    // Upload image to Cloudinary and get secure URL
    const uploadResult = await uploadImage(selectedImage);
    if (!uploadResult || !uploadResult.secure_url) {
      return res.status(500).json({ error: 'Image upload failed.' });
    }
    // Add vendor document to Firestore
    await db.collection('users').add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: 'vendor',
      phoneno,
      surname,
      firstname,
      profilepic: uploadResult.secure_url,
      school: selectedSchool,
      address,
      businessname,
      businesscategory: businessCategory,
      now: 'open',
      balance: 0
    });
    // Generate verification link and send email
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

// Start server on Railway's provided port or default to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
