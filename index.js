require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer"); // ok to keep, even if unused
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

// 1) Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

/* ============== Resend (HTTPS API) ============== */
async function sendEmailViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;         // re_********************************
  const from = process.env.EMAIL_FROM;               // e.g. 'School Chow <support@schoolchow.com>'
  const replyTo = process.env.REPLY_TO || "support@schoolchow.com";
  const messageStream = process.env.RESEND_MESSAGE_STREAM || "outbound";

  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  if (!from) throw new Error("EMAIL_FROM not set");

  const headers = {
    "Reply-To": replyTo,
    "List-Unsubscribe": `<mailto:${replyTo}?subject=Unsubscribe>, <https://schoolchow.com/unsubscribe>`
  };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text, headers, messageStream }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${errText}`);
  }
  return r.json();
}

/* 2) (Optional) Nodemailer SMTP — left as-is but not used now */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

/* 3) Firebase action links */
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    url: process.env.VERIFICATION_CONTINUE_URL || "https://schoolchow.com/verifyemail",
    handleCodeInApp: false,
  };
  return auth.generateEmailVerificationLink(email, actionCodeSettings);
}
async function generatePasswordResetLink(email) {
  const actionCodeSettings = {
    url: process.env.PASSWORD_RESET_CONTINUE_URL || "https://schoolchow.com/resetpassword",
    handleCodeInApp: false,
  };
  return auth.generatePasswordResetLink(email, actionCodeSettings);
}

/* 5) Templates (unchanged styles, safer wording) */
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
        <p style="margin:0 0 12px;">
          Please confirm this email address to finish setting up your School Chow account.
        </p>
        <p style="margin:0;">
          Select <strong>Verify email</strong> to continue.
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
        <p style="margin:0 0 12px;">
        You requested to reset the password for your School Chow account.
      </p>
      <p style="margin:0;">
        Select <strong>Reset password</strong> to create a new one.
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

/* 7) Delete unverified user */
async function deleteUserAccount(user) {
  if (!user) return;
  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('uid', '==', user.uid).get();
  if (!snapshot.empty) {
    for (const doc of snapshot.docs) await doc.ref.delete();
  }
  await auth.deleteUser(user.uid);
}

/* ================= Routes ================= */

// Register (regular)
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
      joinedon: admin.firestore.FieldValue.serverTimestamp()
    });

    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, username);

    await sendEmailViaResend({
      to: email,
      subject: "Verify your email",
      html: emailHTML,
      text: "If the button doesn’t work, copy and paste this link:\n\n" + verificationLink
    });

    res.status(200).json({ message: 'User registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('User registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Register vendor
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
      joinedon: admin.firestore.FieldValue.serverTimestamp()
    });

    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, firstname);

    await sendEmailViaResend({
      to: email,
      subject: "Verify your email",
      html: emailHTML,
      text: "If the button doesn’t work, copy and paste this link:\n\n" + verificationLink
    });

    res.status(200).json({ message: 'Vendor registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Vendor registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Register rider
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
      role: 'driver',
      phoneno,
      surname,
      firstname,
      school,
      address,
      balance: 0,
      joinedon: admin.firestore.FieldValue.serverTimestamp()
    });

    const verificationLink = await generateVerificationLink(email);
    const emailHTML = getVerificationEmailTemplate(verificationLink, firstname);

    await sendEmailViaResend({
      to: email,
      subject: "Verify your email",
      html: emailHTML,
      text: "If the button doesn’t work, copy and paste this link:\n\n" + verificationLink
    });

    res.status(200).json({ message: 'Rider registered successfully. Verification email sent.' });
  } catch (error) {
    console.error('Rider registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Forgot Password
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Please provide your email address.' });
  try {
    const user = await auth.getUserByEmail(email);
    if (!user.emailVerified) {
      return res.status(400).json({ error: 'Your email is not verified. Please verify your email before resetting your password.' });
    }

    const resetLink = await generatePasswordResetLink(email);
    const resetEmailHTML = getPasswordResetEmailTemplate(resetLink, user.displayName || "User");

    await sendEmailViaResend({
      to: email,
      subject: "Reset your password",
      html: resetEmailHTML,
      text: "If the button doesn’t work, copy and paste this link:\n\n" + resetLink
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

// Delete Unverified
app.delete("/delete-unverified", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "No email provided." });
    const user = await auth.getUserByEmail(email);
    if (user.emailVerified) return res.status(400).json({ message: "User is already verified." });
    await deleteUserAccount(user);
    res.status(200).json({ message: "Deleted unverified user successfully." });
  } catch (error) {
    console.error("Error deleting unverified user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin PIN
app.post('/admin/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'Admin PIN is required.' });
  if (pin === process.env.ADMIN_PIN) return res.status(200).json({ success: true, message: 'PIN verified.' });
  return res.status(401).json({ success: false, error: 'Invalid PIN.' });
});

// Boot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
