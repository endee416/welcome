// index.js
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

/* ----------------------------- Health ----------------------------- */
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));

/* ----------------------- Firebase Admin init ---------------------- */
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

/* -------------------------- Resend helper ------------------------- */
async function sendEmailViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;            // re_************************
  const from = process.env.EMAIL_FROM;                  // e.g. 'School Chow <support@schoolchow.com>'
  const messageStream = process.env.RESEND_MESSAGE_STREAM || "outbound";

  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  if (!from) throw new Error("EMAIL_FROM not set");
  if (!to || !subject || (!html && !text)) {
    throw new Error("to, subject and html or text are required");
  }

  const body = { from, to, subject, html, text, messageStream };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${errText}`);
  }
  return r.json(); // { id: "...", ... }
}

/* -------------------- Firebase action links ---------------------- */
async function generateVerificationLink(email) {
  const actionCodeSettings = {
    url: process.env.VERIFICATION_CONTINUE_URL || "https://schoolchow.com/verifyemail",
    handleCodeInApp: false,
  };
  const link = await auth.generateEmailVerificationLink(email, actionCodeSettings);
  return link;
}
async function generatePasswordResetLink(email) {
  const actionCodeSettings = {
    url: process.env.PASSWORD_RESET_CONTINUE_URL || "https://schoolchow.com/resetpassword",
    handleCodeInApp: false,
  };
  const link = await auth.generatePasswordResetLink(email, actionCodeSettings);
  return link;
}

/* -------------------- Spam-safe email templates ------------------- */
// Keep tone neutral, no emojis, no images, one link, include text parts.

function getVerificationEmailHTML(verificationLink, username) {
  const safeUser = String(username || "there");
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Verify your email address</title>
<meta name="color-scheme" content="light dark">
<style>
  body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin:0; padding:24px; background:#fff; color:#111; }
  .box { max-width: 600px; margin: 0 auto; }
  a.button { display:inline-block; padding:10px 16px; border:1px solid #0c513f; text-decoration:none; color:#0c513f; border-radius:6px; }
  .muted { color:#666; font-size:12px; margin-top:16px; }
  .link { word-break: break-all; }
</style></head>
<body>
  <div class="box">
    <h1>Verify your email</h1>
    <p>Hi ${safeUser},</p>
    <p>To finish setting up your School Chow account, please confirm that this email belongs to you.</p>
    <p><a class="button" href="${verificationLink}">Verify email</a></p>
    <p>If the button does not work, copy and paste this link:</p>
    <p class="link">${verificationLink}</p>
    <p class="muted">If you did not create an account, you can ignore this message.</p>
    <p class="muted">School Chow • support@schoolchow.com • © ${year}</p>
  </div>
</body></html>`;
}
function getVerificationEmailTEXT(verificationLink, username) {
  const safeUser = String(username || "there");
  return `Verify your email

Hi ${safeUser},

To finish setting up your School Chow account, confirm your email:

${verificationLink}

If you did not create an account, you can ignore this message.

School Chow • support@schoolchow.com`;
}

function getResetEmailHTML(resetLink, username) {
  const safeUser = String(username || "there");
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Reset your password</title>
<meta name="color-scheme" content="light dark">
<style>
  body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin:0; padding:24px; background:#fff; color:#111; }
  .box { max-width: 600px; margin: 0 auto; }
  a.button { display:inline-block; padding:10px 16px; border:1px solid #0c513f; text-decoration:none; color:#0c513f; border-radius:6px; }
  .muted { color:#666; font-size:12px; margin-top:16px; }
  .link { word-break: break-all; }
</style></head>
<body>
  <div class="box">
    <h1>Reset your password</h1>
    <p>Hi ${safeUser},</p>
    <p>You requested a password reset for your School Chow account.</p>
    <p><a class="button" href="${resetLink}">Reset password</a></p>
    <p>If the button does not work, copy and paste this link:</p>
    <p class="link">${resetLink}</p>
    <p class="muted">If you did not request this, you can ignore this message.</p>
    <p class="muted">School Chow • support@schoolchow.com • © ${year}</p>
  </div>
</body></html>`;
}
function getResetEmailTEXT(resetLink, username) {
  const safeUser = String(username || "there");
  return `Reset your password

Hi ${safeUser},

You requested a password reset for your School Chow account.

Reset link:
${resetLink}

If you did not request this, you can ignore this message.

School Chow • support@schoolchow.com`;
}

/* ------------------------ Utilities / cleanup ---------------------- */
async function deleteUserAccount(user) {
  if (!user) return;
  const snap = await db.collection("users").where("uid", "==", user.uid).get();
  for (const doc of snap.docs) await doc.ref.delete();
  await auth.deleteUser(user.uid);
}

/* ------------------------------ Routes ---------------------------- */

// Regular user register
app.post("/register", async (req, res) => {
  const { email, password, username, surname, phoneno, school } = req.body || {};
  if (!email || !password || !username) {
    return res.status(400).json({ error: "Please provide email, password, and username." });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    if (existingUser && !existingUser.emailVerified) {
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: "Email is already in use and verified. Please log in." });
    }

    const userRecord = await auth.createUser({ email, password, displayName: username });

    await db.collection("users").add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: "regular_user",
      firstname: username,
      surname: surname || "",
      phoneno: phoneno || "",
      school: school || "",
      ordernumber: 0,
      totalorder: 0,
      debt: 0,
      emailVerified: false,
      joinedon: admin.firestore.FieldValue.serverTimestamp(),
    });

    const verificationLink = await generateVerificationLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Verify your email address",
      html: getVerificationEmailHTML(verificationLink, username),
      text: getVerificationEmailTEXT(verificationLink, username),
    });

    return res.status(200).json({ message: "User registered successfully. Verification email sent." });
  } catch (error) {
    console.error("User registration error:", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

// Vendor register
app.post("/vendor/register", async (req, res) => {
  const { email, password, phoneno, surname, firstname, businessname, businessCategory, selectedSchool, address, profilepic } = req.body || {};
  if (!email || !password || !phoneno || !surname || !firstname || !businessname || !businessCategory || !selectedSchool || !address || !profilepic) {
    return res.status(400).json({ error: "Please fill in all fields for vendor registration." });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    if (existingUser && !existingUser.emailVerified) {
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: "Email is already in use and verified. Please log in." });
    }

    const userRecord = await auth.createUser({ email, password, displayName: firstname });

    await db.collection("users").add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: "vendor",
      phoneno,
      surname,
      firstname,
      profilepic,
      school: selectedSchool,
      address,
      businessname,
      businesscategory: businessCategory,
      now: "open",
      balance: 0,
      emailVerified: false,
      joinedon: admin.firestore.FieldValue.serverTimestamp(),
    });

    const verificationLink = await generateVerificationLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Verify your email address",
      html: getVerificationEmailHTML(verificationLink, firstname),
      text: getVerificationEmailTEXT(verificationLink, firstname),
    });

    return res.status(200).json({ message: "Vendor registered successfully. Verification email sent." });
  } catch (error) {
    console.error("Vendor registration error:", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

// Rider register
app.post("/rider/register", async (req, res) => {
  const { email, password, phoneno, surname, firstname, school, address } = req.body || {};
  if (!email || !password || !phoneno || !surname || !firstname || !school || !address) {
    return res.status(400).json({ error: "Please fill in all fields for rider registration." });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }

    if (existingUser && !existingUser.emailVerified) {
      await deleteUserAccount(existingUser);
    } else if (existingUser && existingUser.emailVerified) {
      return res.status(400).json({ error: "Email is already in use and verified. Please log in." });
    }

    const userRecord = await auth.createUser({ email, password });

    await db.collection("users").add({
      uid: userRecord.uid,
      email: userRecord.email,
      role: "driver",
      phoneno,
      surname,
      firstname,
      school,
      address,
      balance: 0,
      emailVerified: false,
      joinedon: admin.firestore.FieldValue.serverTimestamp(),
    });

    const verificationLink = await generateVerificationLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Verify your email address",
      html: getVerificationEmailHTML(verificationLink, firstname),
      text: getVerificationEmailTEXT(verificationLink, firstname),
    });

    return res.status(200).json({ message: "Rider registered successfully. Verification email sent." });
  } catch (error) {
    console.error("Rider registration error:", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

// Forgot password
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Please provide your email address." });
  try {
    const user = await auth.getUserByEmail(email);
    if (!user.emailVerified) {
      return res.status(400).json({ error: "Your email is not verified. Please verify your email before resetting your password." });
    }
    const resetLink = await generatePasswordResetLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Reset your password",
      html: getResetEmailHTML(resetLink, user.displayName || "there"),
      text: getResetEmailTEXT(resetLink, user.displayName || "there"),
    });

    return res.status(200).json({ message: "Password reset email sent successfully." });
  } catch (error) {
    console.error("Forgot password error:", error);
    if (error.code === "auth/invalid-email") {
      return res.status(400).json({ error: "The email address is improperly formatted." });
    } else if (error.code === "auth/user-not-found") {
      return res.status(400).json({ error: "No user found with this email address." });
    } else {
      return res.status(500).json({ error: error.message || "Internal error" });
    }
  }
});

// Delete unverified user by email
app.delete("/delete-unverified", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "No email provided." });
    const user = await auth.getUserByEmail(email);
    if (user.emailVerified) return res.status(400).json({ message: "User is already verified." });
    await deleteUserAccount(user);
    return res.status(200).json({ message: "Deleted unverified user successfully." });
  } catch (error) {
    console.error("Error deleting unverified user:", error);
    return res.status(500).json({ error: error.message || "Internal error" });
  }
});

// Admin PIN
app.post("/admin/login", (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: "Admin PIN is required." });
  if (pin === process.env.ADMIN_PIN) return res.status(200).json({ success: true, message: "PIN verified." });
  return res.status(401).json({ success: false, error: "Invalid PIN." });
});

/* ------------------------------- Boot ----------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
