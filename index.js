// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.json());

// Initialize Firebase Admin SDK using your service account JSON stored as an environment variable.
// Make sure your FIREBASE_SERVICE_ACCOUNT_JSON variable contains the JSON string.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const auth = admin.auth();

// Configure Nodemailer with your Hostinger SMTP settings.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,         // e.g., smtp.hostinger.com
  port: Number(process.env.SMTP_PORT),   // e.g., 465 (SSL) or 587 (TLS)
  secure: Number(process.env.SMTP_PORT) === 465, // true for 465 (SSL), false for 587 (TLS)
  auth: {
    user: process.env.SMTP_USER,         // your custom email address
    pass: process.env.SMTP_PASS,
  },
});

// Helper: Generate Firebase email verification link.
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    // Set this to your deep-link URL; for development, you can use a custom scheme (e.g., "schoolchow://emailVerified")
    url: process.env.VERIFICATION_CONTINUE_URL || "schoolchow://emailVerified",
    handleCodeInApp: true,
  };
  return admin.auth().generateEmailVerificationLink(email, actionCodeSettings);
}

// Helper: Generate the custom HTML email for School Chow.
function getVerificationEmailTemplate(verificationLink, username) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Welcome to School Chow!</title>
    <style>
      body { font-family: Arial, sans-serif; background-color: #fefefe; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .header { text-align: center; padding-bottom: 20px; }
      .header img { max-width: 150px; }
      .content { font-size: 16px; line-height: 1.6; }
      .button { display: inline-block; margin: 20px 0; padding: 12px 20px; background-color: #ff6f61; color: #fff; text-decoration: none; border-radius: 5px; }
      .footer { font-size: 12px; text-align: center; color: #777; padding-top: 20px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <!-- Replace the src with your actual logo URL -->
        <img src="https://example.com/school-chow-logo.png" alt="School Chow Logo">
        <h1>Welcome to School Chow!</h1>
      </div>
      <div class="content">
        <p>Hi ${username},</p>
        <p>Thank you for signing up for School Chow – the fun food app made just for students! We can’t wait for you to explore all our tasty deals and delicious menus.</p>
        <p>Before you dive in, please verify your email address by clicking the button below:</p>
        <p style="text-align:center;"><a class="button" href="${verificationLink}">Verify My Email</a></p>
        <p>If the button doesn't work, copy and paste the link below into your browser:</p>
        <p><a href="${verificationLink}">${verificationLink}</a></p>
        <p>Happy munching,<br>The School Chow Team</p>
      </div>
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} School Chow. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
  `;
}

// Registration endpoint
app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Please provide email, password, and username.' });
  }
  
  try {
    // Check if the user already exists.
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    
    // If user exists and is unverified, delete them to allow re-registration.
    if (existingUser && !existingUser.emailVerified) {
      await auth.deleteUser(existingUser.uid);
      console.log(`Deleted unverified user: ${email}`);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: 'Email is already in use and verified. Please log in.' });
    }
    
    // Create new user.
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: username,
    });
    
    // Generate a custom email verification link.
    const verificationLink = await generateVerificationLink(email);
    
    // Generate the custom email HTML template.
    const emailHTML = getVerificationEmailTemplate(verificationLink, username);
    
    // Send the email using Nodemailer.
    await transporter.sendMail({
      from: `"School Chow" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email for School Chow',
      html: emailHTML,
    });
    
    res.status(200).json({ message: 'User registered successfully. Verification email sent.' });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start the server.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
