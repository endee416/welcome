// index.js
require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

// ---- Health ----
app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));

/* ========================= Firebase Admin ========================= */
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const auth = admin.auth();
const db = admin.firestore();

/* ========================= Deliverability =========================
   - Use your verified domain for From (DKIM/SPF/DMARC must pass)
   - Reply-To should be a monitored mailbox
   - Add List-Unsubscribe (mailto + HTTP)
   - Keep content neutral; only one clickable URL in body
   ================================================================ */

// ---- Resend (HTTP) ----
async function sendEmailViaResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;               // re_************************
  const from = process.env.EMAIL_FROM;                     // 'School Chow <support@schoolchow.com>'
  const replyTo = process.env.REPLY_TO || "support@schoolchow.com";
  const unsubHttp = process.env.UNSUB_HTTP_URL || "https://schoolchow.com/unsubscribe"; // optional
  const unsubMail = process.env.UNSUB_MAILTO || "mailto:support@schoolchow.com?subject=Unsubscribe";
  const messageStream = process.env.RESEND_MESSAGE_STREAM || "outbound";

  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  if (!from) throw new Error("EMAIL_FROM not set");
  if (!to || !subject || (!html && !text)) {
    throw new Error("to, subject and html or text are required");
  }

  // Headers help deliverability; "List-Unsubscribe" is recommended for transactional too
  const headers = {
    "Reply-To": replyTo,
    "List-Unsubscribe": `<${unsubMail}>, <${unsubHttp}>`,
    // DO NOT set "Precedence: bulk" (that would hurt)
  };

  const body = { from, to, subject, html, text, headers, messageStream };

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
  return r.json(); // { id, ... }
}

/* ==================== Firebase Action Links ===================== */
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

/* ===================== Email Templates (Safe) =====================

   Goals:
   - Keep your header/logo/button/footer design
   - Neutral copy; no emojis/caps/hype
   - One hyperlink only (the primary action). The fallback URL is shown as text.
   - System fonts; light CSS; small, single logo
   - Plain-text part provided
=================================================================== */

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function verificationHTML({ link, username }) {
  const u = esc(username || "there");
  const year = new Date().getFullYear();
  // IMPORTANT: Only the button is a clickable link. The fallback shows the URL as plain text (no <a>).
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Verify your email</title>
  <meta name="color-scheme" content="light dark">
  <style>
    body{margin:0;padding:0;background:#f6f7f9;color:#111;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
    .wrap{max-width:620px;margin:0 auto;padding:24px;}
    .card{background:#fff;border:1px solid #e6e7eb;border-radius:10px;overflow:hidden}
    .header{background:#0c513f;padding:20px;text-align:center}
    .brand{display:inline-block;line-height:0}
    .brand img{max-width:160px;height:auto}
    .content{padding:28px}
    h1{font-size:22px;margin:0 0 12px 0;color:#0c513f}
    .hello{font-size:18px;margin:0 0 12px 0}
    p{margin:0 0 12px 0}
    .btn{display:inline-block;padding:12px 18px;border-radius:6px;border:1px solid #0c513f;text-decoration:none;color:#fff;background:#0c513f}
    .muted{color:#666;font-size:13px}
    .fallback{word-break:break-all;font-size:13px}
    .footer{padding:16px 20px;background:#fafbfc;border-top:1px solid #eef0f3;font-size:12px;color:#666}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <a class="brand" href="https://schoolchow.com" target="_blank" rel="noopener">
          <img src="https://schoolchow.com/verifyemail/logo.png" alt="School Chow">
        </a>
      </div>
      <div class="content">
        <h1>Verify your email</h1>
        <p class="hello">Hi ${u},</p>
        <p>To finish setting up your School Chow account, please confirm your email address.</p>
        <p style="margin-top:16px;margin-bottom:16px;">
          <a class="btn" href="${esc(link)}">Verify email</a>
        </p>
        <p class="muted">If the button doesn’t work, copy and paste this link into your browser:</p>
        <p class="fallback">${esc(link)}</p>
        <p class="muted">If you didn’t create an account, you can ignore this message.</p>
      </div>
      <div class="footer">
        School Chow • support@schoolchow.com • © ${year}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function verificationTEXT({ link, username }) {
  const u = String(username || "there");
  return `Verify your email

Hi ${u},

To finish setting up your School Chow account, confirm your email:

${link}

If you didn’t create an account, you can ignore this message.

School Chow • support@schoolchow.com`;
}

function resetHTML({ link, username }) {
  const u = esc(username || "there");
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Reset your password</title>
  <meta name="color-scheme" content="light dark">
  <style>
    body{margin:0;padding:0;background:#f6f7f9;color:#111;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
    .wrap{max-width:620px;margin:0 auto;padding:24px;}
    .card{background:#fff;border:1px solid #e6e7eb;border-radius:10px;overflow:hidden}
    .header{background:#0c513f;padding:20px;text-align:center}
    .brand{display:inline-block;line-height:0}
    .brand img{max-width:160px;height:auto}
    .content{padding:28px}
    h1{font-size:22px;margin:0 0 12px 0;color:#0c513f}
    .hello{font-size:18px;margin:0 0 12px 0}
    p{margin:0 0 12px 0}
    .btn{display:inline-block;padding:12px 18px;border-radius:6px;border:1px solid #0c513f;text-decoration:none;color:#fff;background:#0c513f}
    .muted{color:#666;font-size:13px}
    .fallback{word-break:break-all;font-size:13px}
    .footer{padding:16px 20px;background:#fafbfc;border-top:1px solid #eef0f3;font-size:12px;color:#666}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <a class="brand" href="https://schoolchow.com" target="_blank" rel="noopener">
          <img src="https://schoolchow.com/verifyemail/logo.png" alt="School Chow">
        </a>
      </div>
      <div class="content">
        <h1>Reset your password</h1>
        <p class="hello">Hi ${u},</p>
        <p>You requested a password reset for your School Chow account.</p>
        <p style="margin-top:16px;margin-bottom:16px;">
          <a class="btn" href="${esc(link)}">Reset password</a>
        </p>
        <p class="muted">If the button doesn’t work, copy and paste this link into your browser:</p>
        <p class="fallback">${esc(link)}</p>
        <p class="muted">If you didn’t request this, you can ignore this message.</p>
      </div>
      <div class="footer">
        School Chow • support@schoolchow.com • © ${year}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function resetTEXT({ link, username }) {
  const u = String(username || "there");
  return `Reset your password

Hi ${u},

You requested a password reset for your School Chow account.

Reset link:
${link}

If you didn’t request this, you can ignore this message.

School Chow • support@schoolchow.com`;
}

/* ========================= Helper: cleanup ========================= */
async function deleteUserAccount(user) {
  if (!user) return;
  const snap = await db.collection("users").where("uid", "==", user.uid).get();
  for (const doc of snap.docs) await doc.ref.delete();
  await auth.deleteUser(user.uid);
}

/* ============================== Routes ============================= */

// Register (regular user)
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

    const link = await generateVerificationLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Verify your email",
      html: verificationHTML({ link, username }),
      text: verificationTEXT({ link, username }),
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

    const link = await generateVerificationLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Verify your email",
      html: verificationHTML({ link, username: firstname }),
      text: verificationTEXT({ link, username: firstname }),
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

    const link = await generateVerificationLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Verify your email",
      html: verificationHTML({ link, username: firstname }),
      text: verificationTEXT({ link, username: firstname }),
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
    const link = await generatePasswordResetLink(email);
    await sendEmailViaResend({
      to: email,
      subject: "Reset your password",
      html: resetHTML({ link, username: user.displayName || "there" }),
      text: resetTEXT({ link, username: user.displayName || "there" }),
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

// Delete unverified by email
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
