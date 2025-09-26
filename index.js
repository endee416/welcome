// index.js
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

// Use global fetch if present (Node 18+), otherwise fall back to node-fetch
const fetch = global.fetch || ((...args) => import("node-fetch").then(m => m.default(...args)));

const app = express();
app.use(bodyParser.json());

// ---- Health
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));

/* ================= Firebase Admin ================= */
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

/* ================ Resend (HTTPS API) ================ */
// Minimal, transactional, no tracking. Uses your verified domain in EMAIL_FROM.
async function sendEmailViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;                // re_********
  const from = process.env.EMAIL_FROM;                      // e.g. 'School Chow <no-reply@schoolchow.com>'
  const replyTo = process.env.REPLY_TO || "support@schoolchow.com";
  const messageStream = process.env.RESEND_MESSAGE_STREAM || "outbound"; // transactional stream

  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  if (!from) throw new Error("EMAIL_FROM not set");
  if (!to || !subject || (!html && !text)) throw new Error("to, subject and html or text are required");

  // Transactional-friendly headers (no marketing/unsubscribe/tracking)
  const headers = {
    "Reply-To": replyTo,
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "All"
  };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
      headers,
      messageStream,
      // No analytics/tracking/tags to avoid link rewriting
    }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${errText}`);
  }
  return r.json();
}

/* ============== Firebase Action Links ============== */
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

/* ============== Templates (UNCHANGED look; neutral copy) ============== */
function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function getVerificationEmailHTML(verificationLink, username) {
  const u = esc(username || "there");
  const year = new Date().getFullYear();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Verify your email</title><meta name="color-scheme" content="light dark">
<style>
  body { margin:0; padding:0; background:#f7f7f7; color:#111; font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
  .container { max-width:600px; margin:0 auto; background:#fff; border-radius:8px; overflow:hidden; border:1px solid #ececec; }
  .header { text-align:center; padding:20px; background-color:#0c513f; }
  .header img { max-width:150px; height:auto; display:block; margin:0 auto; }
  .content { padding:28px; text-align:center; }
  h1 { font-size:26px; margin:0 0 8px; color:#0c513f; }
  .hello { font-size:18px; margin:6px 0 16px; }
  p { margin:0 0 12px; }
  .button { background-color:#0c513f; color:#fff; padding:12px 20px; text-decoration:none; border-radius:6px; display:inline-block; margin:18px 0; }
  .muted { color:#666; font-size:13px; }
  .fallback { word-break:break-all; font-size:13px; color:#333; }
  .footer { background:#fafafa; padding:16px; text-align:center; font-size:12px; color:#666; border-top:1px solid #ececec; }
</style>
</head><body>
  <div class="container">
    <div class="header">
      <img src="https://schoolchow.com/verifyemail/logo.png" alt="School Chow">
    </div>
    <div class="content">
      <h1>Verify your email</h1>
      <p class="hello">Hi ${u},</p>
      <p>Please confirm your email address to complete your School Chow account setup.</p>
      <p><a class="button" href="${esc(verificationLink)}">Verify email</a></p>
      <p class="muted">If the button doesn’t work, copy and paste this link into your browser:</p>
      <p class="fallback">${esc(verificationLink)}</p>
      <p class="muted">If you didn’t create an account, you can ignore this message.</p>
    </div>
    <div class="footer">
      School Chow • support@schoolchow.com • © ${year}
    </div>
  </div>
</body></html>`;
}
function getVerificationEmailTEXT(verificationLink, username) {
  const u = String(username || "there");
  return `Verify your email

Hi ${u},

Please confirm your email address to complete your School Chow account setup.

${verificationLink}

If you didn’t create an account, you can ignore this message.

School Chow • support@schoolchow.com`;
}

function getPasswordResetEmailHTML(resetLink, username) {
  const u = esc(username || "there");
  const year = new Date().getFullYear();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Reset your password</title><meta name="color-scheme" content="light dark">
<style>
  body { margin:0; padding:0; background:#f7f7f7; color:#111; font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
  .container { max-width:600px; margin:0 auto; background:#fff; border-radius:8px; overflow:hidden; border:1px solid #ececec; }
  .header { text-align:center; padding:20px; background-color:#0c513f; }
  .header img { max-width:150px; height:auto; display:block; margin:0 auto; }
  .content { padding:28px; text-align:center; }
  h1 { font-size:26px; margin:0 0 8px; color:#0c513f; }
  .hello { font-size:18px; margin:6px 0 16px; }
  p { margin:0 0 12px; }
  .button { background-color:#0c513f; color:#fff; padding:12px 20px; text-decoration:none; border-radius:6px; display:inline-block; margin:18px 0; }
  .muted { color:#666; font-size:13px; }
  .fallback { word-break:break-all; font-size:13px; color:#333; }
  .footer { background:#fafafa; padding:16px; text-align:center; font-size:12px; color:#666; border-top:1px solid #ececec; }
</style>
</head><body>
  <div class="container">
    <div class="header">
      <img src="https://schoolchow.com/verifyemail/logo.png" alt="School Chow">
    </div>
    <div class="content">
      <h1>Reset your password</h1>
      <p class="hello">Hi ${u},</p>
      <p>You requested a password reset for your School Chow account.</p>
      <p><a class="button" href="${esc(resetLink)}">Reset password</a></p>
      <p class="muted">If the button doesn’t work, copy and paste this link into your browser:</p>
      <p class="fallback">${esc(resetLink)}</p>
      <p class="muted">If you didn’t request this, you can ignore this message.</p>
    </div>
    <div class="footer">
      School Chow • support@schoolchow.com • © ${year}
    </div>
  </div>
</body></html>`;
}
function getPasswordResetEmailTEXT(resetLink, username) {
  const u = String(username || "there");
  return `Reset your password

Hi ${u},

You requested a password reset for your School Chow account.

${resetLink}

If you didn’t request this, you can ignore this message.

School Chow • support@schoolchow.com`;
}

/* ================= Helpers ================= */
async function deleteUserAccount(user) {
  if (!user) return;
  const usersRef = db.collection("users");
  const snapshot = await usersRef.where("uid", "==", user.uid).get();
  if (!snapshot.empty) {
    for (const doc of snapshot.docs) await doc.ref.delete();
  }
  await auth.deleteUser(user.uid);
}

/* ================= Routes ================= */

// 8) Register a regular user
app.post("/register", async (req, res) => {
  const { email, password, username, surname, phoneno, school } = req.body || {};
  if (!email || !password || !username) {
    return res.status(400).json({ error: "Please provide email, password, and username." });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
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
      subject: "Verify your email",
      html: getVerificationEmailHTML(verificationLink, username),
      text: getVerificationEmailTEXT(verificationLink, username),
    });

    return res.status(200).json({ message: "User registered successfully. Verification email sent." });
  } catch (error) {
    console.error("User registration error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 9) Register a vendor
app.post("/vendor/register", async (req, res) => {
  const { email, password, phoneno, surname, firstname, businessname, businessCategory, selectedSchool, address, profilepic } = req.body || {};
  if (!email || !password || !phoneno || !surname || !firstname || !businessname || !businessCategory || !selectedSchool || !address || !profilepic) {
    return res.status(400).json({ error: "Please fill in all fields for vendor registration." });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
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
      subject: "Verify your email",
      html: getVerificationEmailHTML(verificationLink, firstname),
      text: getVerificationEmailTEXT(verificationLink, firstname),
    });

    return res.status(200).json({ message: "Vendor registered successfully. Verification email sent." });
  } catch (error) {
    console.error("Vendor registration error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 10) Register a rider
app.post("/rider/register", async (req, res) => {
  const { email, password, phoneno, surname, firstname, school, address } = req.body || {};
  if (!email || !password || !phoneno || !surname || !firstname || !school || !address) {
    return res.status(400).json({ error: "Please fill in all fields for rider registration." });
  }
  try {
    let existingUser;
    try {
      existingUser = await auth.getUserByEmail(email);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
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
      subject: "Verify your email",
      html: getVerificationEmailHTML(verificationLink, firstname),
      text: getVerificationEmailTEXT(verificationLink, firstname),
    });

    return res.status(200).json({ message: "Rider registered successfully. Verification email sent." });
  } catch (error) {
    console.error("Rider registration error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// 11) Forgot Password Endpoint
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
      html: getPasswordResetEmailHTML(resetLink, user.displayName || "there"),
      text: getPasswordResetEmailTEXT(resetLink, user.displayName || "there"),
    });

    return res.status(200).json({ message: "Password reset email sent successfully." });
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
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "No email provided." });
    const user = await auth.getUserByEmail(email);
    if (user.emailVerified) return res.status(400).json({ message: "User is already verified." });
    await deleteUserAccount(user);
    return res.status(200).json({ message: "Deleted unverified user successfully." });
  } catch (error) {
    console.error("Error deleting unverified user:", error);
    return res.status(500).json({ error: error.message });
  }
});

// --- Admin PIN Login Endpoint ---
app.post("/admin/login", (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: "Admin PIN is required." });
  if (pin === process.env.ADMIN_PIN) return res.status(200).json({ success: true, message: "PIN verified." });
  return res.status(401).json({ success: false, error: "Invalid PIN." });
});

// 13) Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
