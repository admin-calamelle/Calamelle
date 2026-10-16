import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, initializeDatabase, mapQuestion, insertQuestion, purgeExpiredSuspendedUsers } from './db.js';
import { config, assertProductionConfig } from './config.js';
import { authOptional, requireAuth, requireRole, createSession, signToken, revokeSession, revokeUserSessions } from './auth.js';
import { id, now, normalizeEmail, sanitizeUser, shuffle, clamp } from './utils.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendEmailChangeVerificationEmail } from './email.js';
import { stripePlans, stripeConfigured, createStripeCustomer, createCheckoutSession, createBillingPortalSession, retrieveCheckoutSession, retrieveSubscription, verifyStripeWebhookSignature } from './stripe.js';
import { getAccessSummary, ensureQuestionAccess, recordDailyQuestionAttempt, reserveNextDailyFreeQuestion, assertCivicMockAvailable, accessErrorResponse, getActivePlan, hasFullAccess, hasNaturalisationAccess, hasUnlimitedQuestionAccess, questionAlreadyUnlocked } from './access.js';

assertProductionConfig();
await initializeDatabase();
try {await purgeExpiredSuspendedUsers();} catch (error) {console.error('Suspended-user purge failed:', error);}

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.frontendUrl, credentials: false }));

// Stripe requires the exact raw request bytes to validate webhook signatures.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json({ limit: '3mb' }));
app.use(authOptional);

// Lightweight process-local throttling for authentication endpoints.
// For high-traffic multi-instance deployments, move these counters to Redis/KV.
const requestBuckets = new Map();
function rateLimit({ windowMs, max, key = (req) => req.ip || 'unknown' }) {
  return (req, res, next) => {
    const bucketKey = key(req);
    const current = Date.now();
    const previous = requestBuckets.get(bucketKey);
    const state = !previous || previous.resetAt <= current ?
    { count: 0, resetAt: current + windowMs } :
    previous;
    state.count += 1;
    requestBuckets.set(bucketKey, state);
    if (state.count > max) {
      return res.status(429).json({
        error: 'Trop de tentatives. Réessayez dans quelques instants.',
        retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - current) / 1000))
      });
    }
    next();
  };
}
const loginIpLimiter = rateLimit({ windowMs: 10 * 60_000, max: 60, key: (req) => `login-ip:${req.ip}` });
const loginLimiter = rateLimit({ windowMs: 10 * 60_000, max: 20, key: (req) => `login:${req.ip}:${String(req.body?.email || '').toLowerCase()}` });
const forgotIpLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, key: (req) => `forgot-ip:${req.ip}` });
const forgotLimiter = rateLimit({ windowMs: 15 * 60_000, max: 6, key: (req) => `forgot:${req.ip}:${String(req.body?.email || '').toLowerCase()}` });
const registerLimiter = rateLimit({ windowMs: 10 * 60_000, max: 12, key: (req) => `register:${req.ip}` });
const emailChangeLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, key: (req) => `email-change:${req.ip}:${req.auth?.sub || 'guest'}` });

if (!process.env.VERCEL) {
  const suspendedPurgeTimer = setInterval(async () => {
    try {
      const removed = await purgeExpiredSuspendedUsers();
      if (removed.length) console.log(`Deleted ${removed.length} suspended Calamelle account(s) after the 24h grace period.`);
    } catch (error) {
      console.error('Scheduled suspended-user purge failed:', error);
    }
  }, 60_000);
  suspendedPurgeTimer.unref?.();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'calamelle-api', time: now(), paymentsMode: config.paymentsMode });
});

// ---------------- AUTH ----------------
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function otpExpiryIso() {
  return new Date(Date.now() + config.otpExpiryMinutes * 60_000).toISOString();
}

function remainingSeconds(iso) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

function makeOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function registerResponse({ email, otp, mailMode }) {
  return {
    email,
    message: 'Un code de vérification a été envoyé à votre adresse e-mail.',
    expiresInSeconds: config.otpExpiryMinutes * 60,
    resendAfterSeconds: config.otpResendSeconds,
    mailMode,
    ...(config.exposeDevOtp ? { devOtp: otp } : {})
  };
}

app.post('/api/auth/register/start', registerLimiter, async (req, res) => {
  const firstName = String(req.body?.firstName || '').trim().replace(/\s+/g, ' ');
  const lastName = String(req.body?.lastName || '').trim().replace(/\s+/g, ' ');
  const legacyName = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  const fallbackParts = legacyName.split(/\s+/).filter(Boolean);
  const resolvedFirstName = firstName || fallbackParts.shift() || '';
  const resolvedLastName = lastName || fallbackParts.join(' ') || '';
  const name = `${resolvedFirstName} ${resolvedLastName}`.trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!resolvedFirstName || resolvedFirstName.length > 80) return res.status(400).json({ error: 'Le prénom est requis.' });
  if (!resolvedLastName || resolvedLastName.length > 100) return res.status(400).json({ error: 'Le nom est requis.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });

  await db.prepare('DELETE FROM pending_registrations WHERE otp_expires_at < ?').run(now());
  const existing = await db.prepare('SELECT * FROM pending_registrations WHERE email = ?').get(email);
  if (existing) {
    const elapsed = Math.floor((Date.now() - new Date(existing.last_sent_at).getTime()) / 1000);
    if (elapsed < config.otpResendSeconds) {
      return res.status(429).json({
        error: `Veuillez patienter ${config.otpResendSeconds - elapsed} seconde(s) avant de demander un nouveau code.`,
        retryAfterSeconds: config.otpResendSeconds - elapsed
      });
    }
  }

  const otp = makeOtp();
  const [passwordHash, otpHash] = await Promise.all([
  bcrypt.hash(password, 10),
  bcrypt.hash(otp, 8)]
  );
  const sentAt = now();
  const expiresAt = otpExpiryIso();
  const createdAt = existing?.created_at || sentAt;
  const resendCount = existing ? Number(existing.resend_count || 0) + 1 : 0;

  if (resendCount > config.otpMaxResends) {
    return res.status(429).json({ error: 'Trop de demandes de code. Recommencez l’inscription dans quelques minutes.' });
  }

  await db.prepare(`INSERT INTO pending_registrations
    (email,name,first_name,last_name,password_hash,otp_hash,otp_expires_at,attempts,resend_count,last_sent_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET
      name=excluded.name,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      password_hash=excluded.password_hash,
      otp_hash=excluded.otp_hash,
      otp_expires_at=excluded.otp_expires_at,
      attempts=0,
      resend_count=excluded.resend_count,
      last_sent_at=excluded.last_sent_at`).
  run(email, name, resolvedFirstName, resolvedLastName, passwordHash, otpHash, expiresAt, 0, resendCount, sentAt, createdAt);

  const mail = await sendVerificationEmail({ email, name, otp });
  if (!mail.ok) {
    await db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(email);
    return res.status(503).json({ error: mail.error || 'Impossible d’envoyer le code de vérification.' });
  }

  res.status(202).json(registerResponse({ email, otp, mailMode: mail.mode }));
});

app.post('/api/auth/register/resend', registerLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Ce compte est déjà créé. Connectez-vous.' });

  const pending = await db.prepare('SELECT * FROM pending_registrations WHERE email = ?').get(email);
  if (!pending) return res.status(404).json({ error: 'Inscription introuvable. Recommencez la création du compte.' });

  const elapsed = Math.floor((Date.now() - new Date(pending.last_sent_at).getTime()) / 1000);
  if (elapsed < config.otpResendSeconds) {
    return res.status(429).json({
      error: `Veuillez patienter ${config.otpResendSeconds - elapsed} seconde(s).`,
      retryAfterSeconds: config.otpResendSeconds - elapsed
    });
  }
  if (Number(pending.resend_count || 0) >= config.otpMaxResends) {
    return res.status(429).json({ error: 'Nombre maximal de renvois atteint. Recommencez l’inscription.' });
  }

  const otp = makeOtp();
  const otpHash = await bcrypt.hash(otp, 8);
  const sentAt = now();
  const expiresAt = otpExpiryIso();
  await db.prepare(`UPDATE pending_registrations
    SET otp_hash = ?, otp_expires_at = ?, attempts = 0, resend_count = resend_count + 1, last_sent_at = ?
    WHERE email = ?`).run(otpHash, expiresAt, sentAt, email);

  const mail = await sendVerificationEmail({ email, name: pending.name, otp });
  if (!mail.ok) return res.status(503).json({ error: mail.error || 'Impossible d’envoyer le code de vérification.' });
  res.json(registerResponse({ email, otp, mailMode: mail.mode }));
});

app.post('/api/auth/register/verify', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const otp = String(req.body?.otp || '').replace(/\D/g, '').slice(0, 6);
  if (!validEmail(email) || otp.length !== 6) return res.status(400).json({ error: 'Code de vérification invalide.' });

  const pending = await db.prepare('SELECT * FROM pending_registrations WHERE email = ?').get(email);
  if (!pending) return res.status(404).json({ error: 'Inscription introuvable. Recommencez la création du compte.' });
  if (new Date(pending.otp_expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'Ce code a expiré. Demandez un nouveau code.', expired: true });
  }
  if (Number(pending.attempts || 0) >= config.otpMaxAttempts) {
    return res.status(429).json({ error: 'Trop de tentatives. Demandez un nouveau code.' });
  }

  const valid = await bcrypt.compare(otp, pending.otp_hash);
  if (!valid) {
    const attempts = Number(pending.attempts || 0) + 1;
    await db.prepare('UPDATE pending_registrations SET attempts = ? WHERE email = ?').run(attempts, email);
    return res.status(400).json({
      error: attempts >= config.otpMaxAttempts ? 'Trop de tentatives. Demandez un nouveau code.' : 'Code incorrect.',
      attemptsRemaining: Math.max(0, config.otpMaxAttempts - attempts)
    });
  }

  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    await db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(email);
    return res.status(409).json({ error: 'Ce compte existe déjà. Connectez-vous.' });
  }

  const user = {
    id: id(),
    name: pending.name,
    first_name: pending.first_name || String(pending.name || '').trim().split(/\s+/)[0] || '',
    last_name: pending.last_name || String(pending.name || '').trim().split(/\s+/).slice(1).join(' ') || '-',
    email,
    role: 'learner',
    premium_plan: null,
    premium_until: null,
    email_verified_at: now(),
    created_at: now()
  };

  try {
    await db.exec('BEGIN');
    await db.prepare(`INSERT INTO users
      (id,name,first_name,last_name,email,password_hash,role,premium_plan,premium_until,email_verified_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).
    run(user.id, user.name, user.first_name, user.last_name, user.email, pending.password_hash, user.role, null, null, user.email_verified_at, user.created_at);
    await db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(email);
    await db.exec('COMMIT');
  } catch (error) {
    try {await db.exec('ROLLBACK');} catch {}
    console.error('Verified registration failed:', error);
    return res.status(500).json({ error: 'Impossible de finaliser la création du compte.' });
  }

  const session = await createSession(user, { userAgent: req.get('user-agent') || '', ipAddress: req.ip || '' });
  res.status(201).json({ user, token: signToken(user, session.id) });
});

app.post('/api/auth/register/status', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const pending = await db.prepare('SELECT email,otp_expires_at,last_sent_at,resend_count FROM pending_registrations WHERE email = ?').get(email);
  if (!pending) return res.json({ pending: false });
  const elapsed = Math.floor((Date.now() - new Date(pending.last_sent_at).getTime()) / 1000);
  res.json({
    pending: true,
    expiresInSeconds: remainingSeconds(pending.otp_expires_at),
    resendInSeconds: Math.max(0, config.otpResendSeconds - elapsed),
    resendCount: pending.resend_count
  });
});

app.post('/api/auth/login', loginIpLimiter, loginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  }
  if (user.status === 'suspended') {
    return res.status(423).json({
      error: 'Ce compte est suspendu. Il sera supprimé automatiquement après le délai de 24 heures sauf réactivation par un administrateur.',
      code: 'ACCOUNT_SUSPENDED',
      scheduledDeleteAt: user.scheduled_delete_at || null
    });
  }
  const safe = sanitizeUser(user);
  const session = await createSession(safe, { userAgent: req.get('user-agent') || '', ipAddress: req.ip || '' });
  res.json({ user: safe, token: signToken(safe, session.id) });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await revokeSession(req.auth.sessionId);
  res.status(204).end();
});

app.post('/api/auth/password/forgot', forgotIpLimiter, forgotLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });

  const genericMessage = 'Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé.';
  const user = await db.prepare('SELECT id,name,email FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ message: genericMessage });

  // Remove expired/old unused tokens for this account before creating a new one.
  await db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < ?)').run(user.id, now());
  await db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + config.passwordResetMinutes * 60_000).toISOString();
  await db.prepare(`INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,used_at,created_at)
    VALUES (?,?,?,?,NULL,?)`).run(id(), user.id, tokenHash, expiresAt, now());

  const resetUrl = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const mail = await sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl });
  if (!mail.ok) {
    await db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHash);
    return res.status(503).json({ error: mail.error || 'Le service e-mail est momentanément indisponible.' });
  }

  res.json({
    message: genericMessage,
    ...(config.exposeDevOtp && mail.mode === 'console' ? { devResetUrl: resetUrl } : {})
  });
});

app.post('/api/auth/password/reset', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!token) return res.status(400).json({ error: 'Lien de réinitialisation invalide.' });
  if (password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await db.prepare(`SELECT prt.*, u.email FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id WHERE prt.token_hash = ?`).get(tokenHash);
  if (!record || record.used_at || new Date(record.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await db.exec('BEGIN');
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, record.user_id);
    await db.prepare('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ? AND revoked_at IS NULL').run(now(), record.user_id);
    await db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now(), record.id);
    await db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?').run(record.user_id, record.id);
    await db.exec('COMMIT');
  } catch (error) {
    try {await db.exec('ROLLBACK');} catch {}
    console.error('Password reset failed:', error);
    return res.status(500).json({ error: 'Impossible de mettre à jour le mot de passe.' });
  }

  res.json({ message: 'Votre mot de passe a été modifié. Vous pouvez maintenant vous connecter.' });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ user: sanitizeUser(user) });
});

// ---------------- PROFILE ----------------
app.patch('/api/profile/name', requireAuth, async (req, res) => {
  const firstName = String(req.body?.firstName || '').trim().replace(/\s+/g, ' ');
  const lastName = String(req.body?.lastName || '').trim().replace(/\s+/g, ' ');
  if (!firstName || firstName.length > 80) return res.status(400).json({ error: 'Le prénom est requis.' });
  if (!lastName || lastName.length > 100) return res.status(400).json({ error: 'Le nom est requis.' });
  const displayName = `${firstName} ${lastName}`.trim();
  await db.prepare('UPDATE users SET first_name=?,last_name=?,name=? WHERE id=?').
  run(firstName, lastName, displayName, req.auth.sub);
  const updated = await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  res.json({ message: 'Nom mis à jour.', user: sanitizeUser(updated) });
});

app.post('/api/profile/email-change/start', requireAuth, emailChangeLimiter, async (req, res) => {
  const newEmail = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (!validEmail(newEmail)) return res.status(400).json({ error: 'Nouvelle adresse e-mail invalide.' });
  if (newEmail === normalizeEmail(user.email)) return res.status(400).json({ error: 'Cette adresse est déjà associée à votre compte.' });
  if (!password || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
  }
  if (await db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(newEmail, user.id)) {
    return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée par un autre compte.' });
  }
  const claimed = await db.prepare('SELECT user_id FROM email_change_requests WHERE new_email=? AND user_id<>?').get(newEmail, user.id);
  if (claimed) return res.status(409).json({ error: 'Cette adresse e-mail est déjà en cours de vérification.' });

  const existing = await db.prepare('SELECT * FROM email_change_requests WHERE user_id=?').get(user.id);
  if (existing && existing.new_email === newEmail) {
    const elapsed = Math.floor((Date.now() - new Date(existing.last_sent_at).getTime()) / 1000);
    if (elapsed < config.otpResendSeconds) {
      return res.status(429).json({
        error: `Veuillez patienter ${config.otpResendSeconds - elapsed} seconde(s) avant de renvoyer un code.`,
        retryAfterSeconds: config.otpResendSeconds - elapsed
      });
    }
    if (Number(existing.resend_count || 0) >= config.otpMaxResends) {
      return res.status(429).json({ error: 'Nombre maximal de renvois atteint. Recommencez la modification plus tard.' });
    }
  }

  const otp = makeOtp();
  const otpHash = await bcrypt.hash(otp, 8);
  const sentAt = now();
  const expiresAt = otpExpiryIso();
  const createdAt = existing?.created_at || sentAt;
  const resendCount = existing && existing.new_email === newEmail ? Number(existing.resend_count || 0) + 1 : 0;

  await db.prepare(`INSERT INTO email_change_requests
    (user_id,new_email,otp_hash,otp_expires_at,attempts,resend_count,last_sent_at,created_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      new_email=excluded.new_email,otp_hash=excluded.otp_hash,otp_expires_at=excluded.otp_expires_at,
      attempts=0,resend_count=excluded.resend_count,last_sent_at=excluded.last_sent_at`).
  run(user.id, newEmail, otpHash, expiresAt, 0, resendCount, sentAt, createdAt);

  const mail = await sendEmailChangeVerificationEmail({ email: newEmail, name: user.name, otp });
  if (!mail.ok) {
    await db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(user.id);
    return res.status(503).json({ error: mail.error || 'Impossible d’envoyer le code de vérification.' });
  }

  res.status(202).json({
    email: newEmail,
    message: 'Un code de vérification a été envoyé à votre nouvelle adresse e-mail.',
    expiresInSeconds: config.otpExpiryMinutes * 60,
    resendAfterSeconds: config.otpResendSeconds,
    mailMode: mail.mode,
    ...(config.exposeDevOtp ? { devOtp: otp } : {})
  });
});

app.post('/api/profile/email-change/verify', requireAuth, emailChangeLimiter, async (req, res) => {
  const otp = String(req.body?.otp || '').replace(/\D/g, '').slice(0, 6);
  if (otp.length !== 6) return res.status(400).json({ error: 'Code de vérification invalide.' });
  const record = await db.prepare('SELECT * FROM email_change_requests WHERE user_id=?').get(req.auth.sub);
  if (!record) return res.status(404).json({ error: 'Aucune modification d’e-mail en attente.' });
  if (new Date(record.otp_expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'Ce code a expiré. Demandez un nouveau code.', expired: true });
  }
  if (Number(record.attempts || 0) >= config.otpMaxAttempts) {
    return res.status(429).json({ error: 'Trop de tentatives. Demandez un nouveau code.' });
  }
  if (await db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(record.new_email, req.auth.sub)) {
    await db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(req.auth.sub);
    return res.status(409).json({ error: 'Cette adresse e-mail vient d’être utilisée par un autre compte.' });
  }

  const valid = await bcrypt.compare(otp, record.otp_hash);
  if (!valid) {
    const attempts = Number(record.attempts || 0) + 1;
    await db.prepare('UPDATE email_change_requests SET attempts=? WHERE user_id=?').run(attempts, req.auth.sub);
    return res.status(400).json({
      error: attempts >= config.otpMaxAttempts ? 'Trop de tentatives. Demandez un nouveau code.' : 'Code incorrect.',
      attemptsRemaining: Math.max(0, config.otpMaxAttempts - attempts)
    });
  }

  try {
    await db.exec('BEGIN');
    await db.prepare('UPDATE users SET email=?,email_verified_at=? WHERE id=?').run(record.new_email, now(), req.auth.sub);
    await db.prepare('DELETE FROM email_change_requests WHERE user_id=?').run(req.auth.sub);
    await db.prepare(`UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?)
      WHERE user_id=? AND id<>? AND revoked_at IS NULL`).run(now(), req.auth.sub, req.auth.sessionId);
    await db.exec('COMMIT');
  } catch (error) {
    try {await db.exec('ROLLBACK');} catch {}
    console.error('Email change verification failed:', error);
    return res.status(500).json({ error: 'Impossible de modifier l’adresse e-mail.' });
  }

  const updated = await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  res.json({ message: 'Adresse e-mail vérifiée et mise à jour.', user: sanitizeUser(updated) });
});

// ---------------- ACCESS / QUESTIONS ----------------
app.get('/api/access/summary', requireAuth, async (req, res) => {
  const access = await getAccessSummary(req.auth.sub);
  if (!access) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({ access });
});

app.get('/api/questions/categories', async (_req, res) => {
  const rows = await db.prepare(`SELECT category, COUNT(*) AS count FROM questions WHERE is_active = 1 AND status='published' GROUP BY category ORDER BY category`).all();
  res.json({ categories: rows });
});

function questionFilters(req) {
  const category = req.query.category ? String(req.query.category) : null;
  const civic = req.query.civic === 'true' ? 1 : req.query.civic === 'false' ? 0 : null;
  const search = req.query.search ? String(req.query.search).trim() : '';
  const difficulty = req.query.difficulty ? String(req.query.difficulty) : null;
  const params = [];
  const where = ["is_active = 1", "status = 'published'"];
  if (category) {where.push('category = ?');params.push(category);}
  if (civic !== null) {where.push('is_civic = ?');params.push(civic);}
  if (difficulty) {where.push('difficulty = ?');params.push(difficulty);}
  if (search) {
    where.push('(prompt LIKE ? OR explanation LIKE ? OR category LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  return { where, params };
}

async function currentUser(req) {
  return req.auth?.sub ? await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub) : null;
}

const GUEST_PREVIEW_LIMIT = 5;
async function guestPreviewRows() {
  const rows = await db.prepare("SELECT * FROM questions WHERE is_active=1 AND status='published' ORDER BY id").all();
  if (!rows.length) return [];
  const dayNumber = Math.floor(Date.now() / 86400000);
  const start = dayNumber * GUEST_PREVIEW_LIMIT % rows.length;
  const preview = [];
  for (let i = 0; i < Math.min(GUEST_PREVIEW_LIMIT, rows.length); i++) preview.push(rows[(start + i) % rows.length]);
  return preview;
}
async function isGuestPreviewQuestion(questionId) {
  return (await guestPreviewRows()).some((q) => q.id === questionId);
}
async function activeExamContainsQuestion(userId, questionId) {
  const sessions = await db.prepare(`SELECT question_ids_json FROM exam_sessions
    WHERE user_id=? AND submitted_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 3`).all(userId, now());
  return sessions.some((session) => {
    try {return JSON.parse(session.question_ids_json || '[]').includes(questionId);}
    catch {return false;}
  });
}
async function learnerHasCourseQuestion(userId, courseId, questionId) {
  if (!userId || !courseId || !questionId) return false;
  return Boolean(await db.prepare(`SELECT 1 FROM courses c
    JOIN course_cohorts cc ON cc.course_id=c.id
    JOIN cohort_members cm ON cm.cohort_id=cc.cohort_id
    JOIN course_questions cq ON cq.course_id=c.id
    JOIN questions q ON q.id=cq.question_id
    WHERE c.id=? AND cm.user_id=? AND cq.question_id=? AND c.status='published'
      AND q.is_active=1 AND q.status='published' LIMIT 1`).get(courseId, userId, questionId));
}

// Free-plan dashboard ritual: one stable question at a time, mixed across
// all non-civic learning categories. A question only consumes quota after the
// learner validates an answer, never merely by loading or refreshing it.
app.get('/api/questions/free-daily/next', requireAuth, async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  if (hasFullAccess(user)) {
    const question = await db.prepare(`SELECT * FROM questions
      WHERE is_active=1 AND status='published' AND is_civic=0
      ORDER BY RANDOM() LIMIT 1`).get();
    if (!question) return res.status(404).json({ error: 'Aucune question disponible.' });
    return res.json({
      question: await mapQuestion(question),
      complete: false,
      unlimited: true,
      access: await getAccessSummary(user)
    });
  }

  try {
    const result = await reserveNextDailyFreeQuestion(user.id);
    return res.json({
      ...result,
      question: result.question ? await mapQuestion(result.question) : null,
      session: {
        used: result.access?.dailyNewQuestions?.used ?? 0,
        remaining: result.access?.dailyNewQuestions?.remaining ?? 0,
        total: result.access?.dailyNewQuestions?.limit ?? 20,
        correct: result.access?.dailyNewQuestions?.correct ?? 0,
        incorrect: result.access?.dailyNewQuestions?.incorrect ?? 0,
        accuracy: result.access?.dailyNewQuestions?.accuracy ?? 0,
        currentNumber: result.currentNumber || null
      }
    });
  } catch (error) {
    if (accessErrorResponse(res, error)) return;
    throw error;
  }
});

app.get('/api/questions/daily', async (req, res) => {
  const rows = await db.prepare("SELECT * FROM questions WHERE is_active = 1 AND status='published' ORDER BY id").all();
  if (!rows.length) return res.status(404).json({ error: 'Aucune question disponible.' });
  const dayNumber = Math.floor(Date.now() / 86400000);
  const preferredIndex = dayNumber % rows.length;

  if (!req.auth?.sub) {
    const preview = await guestPreviewRows();
    const question = preview[dayNumber % Math.max(1, preview.length)] || rows[preferredIndex];
    return res.json({ question: await mapQuestion(question), guestPreview: true, previewLimit: GUEST_PREVIEW_LIMIT });
  }

  // Legacy single daily-question endpoint used for guests/full-access users.
  // Merely loading it never consumes the free quota; limited learners now use
  // /questions/free-daily/next for the one-at-a-time 20-question dashboard flow.
  const preferred = rows[preferredIndex];
  try {
    await ensureQuestionAccess(req.auth.sub, preferred);
    return res.json({ question: await mapQuestion(preferred), access: await getAccessSummary(req.auth.sub) });
  } catch (error) {
    if (error?.code !== 'FREE_DAILY_LIMIT') {
      if (accessErrorResponse(res, error)) return;
      throw error;
    }
  }

  const user = await currentUser(req);
  let fallback = null;
  if (user && getActivePlan(user) === 'naturalisation') {
    fallback = await db.prepare("SELECT * FROM questions WHERE is_active=1 AND status='published' AND is_civic=1 ORDER BY RANDOM() LIMIT 1").get();
  }
  if (!fallback) {
    fallback = await db.prepare(`SELECT q.* FROM questions q
      WHERE q.is_active=1 AND q.status='published' AND (
        EXISTS(SELECT 1 FROM progress p WHERE p.user_id=? AND p.question_id=q.id)
        OR EXISTS(SELECT 1 FROM daily_free_questions d WHERE d.user_id=? AND d.question_id=q.id AND d.answered_at IS NOT NULL)
      ) ORDER BY RANDOM() LIMIT 1`).get(req.auth.sub, req.auth.sub);
  }
  if (fallback) return res.json({ question: await mapQuestion(fallback), access: await getAccessSummary(req.auth.sub), quotaFallback: true });

  return res.status(402).json({
    error: 'Vous avez atteint votre limite de nouvelles questions pour aujourd’hui.',
    code: 'FREE_DAILY_LIMIT',
    access: await getAccessSummary(req.auth.sub)
  });
});

app.get('/api/questions', async (req, res) => {
  const requestedLimit = clamp(Number(req.query.limit || 20), 1, 200);
  const { where, params } = questionFilters(req);
  const user = await currentUser(req);

  // Guests get the same small deterministic preview pool for the day. Repeating
  // requests cannot scrape random chunks of the complete question bank.
  if (!user) {
    const previewIds = new Set((await guestPreviewRows()).map((q) => q.id));
    const filtered = (await db.prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY id`).all(...params)).
    filter((q) => previewIds.has(q.id)).
    slice(0, Math.min(requestedLimit, GUEST_PREVIEW_LIMIT));
    return res.json({ questions: await Promise.all(filtered.map(q => mapQuestion(q))), total: filtered.length, guestPreview: true, previewLimit: GUEST_PREVIEW_LIMIT });
  }

  if (hasFullAccess(user)) {
    const rows = await db.prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT ?`).all(...params, requestedLimit);
    return res.json({ questions: await Promise.all(rows.map(q => mapQuestion(q))), total: rows.length, access: await getAccessSummary(user) });
  }

  // Limited accounts can browse already-studied questions freely, while only
  // the number of NEW questions still available today is included in a session.
  // Loading this list does not consume quota; quota is consumed on valid answer.
  const candidates = await db.prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY RANDOM()`).all(...params);
  const selected = [];
  const access = await getAccessSummary(user);
  let newSlots = Number(access?.dailyNewQuestions?.remaining ?? 0);
  for (const q of candidates) {
    if (selected.length >= requestedLimit) break;
    if (hasUnlimitedQuestionAccess(user, q) || (await questionAlreadyUnlocked(user.id, q.id))) {
      selected.push(q);
      continue;
    }
    if (newSlots > 0) {
      selected.push(q);
      newSlots -= 1;
    }
  }

  res.json({
    questions: await Promise.all(selected.map(q => mapQuestion(q))),
    total: selected.length,
    access
  });
});

app.get('/api/questions/:id', async (req, res) => {
  const q = await db.prepare("SELECT * FROM questions WHERE id = ? AND is_active = 1 AND status='published'").get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question introuvable.' });
  if (!req.auth?.sub && !(await isGuestPreviewQuestion(q.id))) {
    return res.status(403).json({ error: 'Créez un compte pour accéder à davantage de questions.', code: 'GUEST_PREVIEW_LIMIT' });
  }
  if (req.auth?.sub) {
    try {await ensureQuestionAccess(req.auth.sub, q);}
    catch (error) {if (accessErrorResponse(res, error)) return;throw error;}
  }
  res.json({ question: await mapQuestion(q), ...(req.auth?.sub ? { access: await getAccessSummary(req.auth.sub) } : { guestPreview: true }) });
});

// Validate an answer without leaking civic-exam answers or exposing the full bank to guests.
app.post('/api/questions/:id/answer', async (req, res) => {
  const answerId = String(req.body?.answerId || '');
  const courseId = String(req.body?.courseId || '').trim();
  const requestedSource = String(req.body?.source || '').trim();
  const attemptSource = ['dashboard', 'learning', 'review'].includes(requestedSource) ? requestedSource : 'learning';
  const q = await db.prepare("SELECT * FROM questions WHERE id = ? AND is_active = 1 AND status='published'").get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question introuvable.' });

  let courseAccess = false;
  if (!req.auth?.sub) {
    if (!(await isGuestPreviewQuestion(q.id))) {
      return res.status(403).json({ error: 'Créez un compte pour continuer.', code: 'GUEST_PREVIEW_LIMIT' });
    }
  } else {
    courseAccess = Boolean(courseId && (await learnerHasCourseQuestion(req.auth.sub, courseId, q.id)));
    if (courseId && !courseAccess) return res.status(403).json({ error: 'Cette question ne fait pas partie de ce cours ou ce cours ne vous est pas affecté.' });
    if (!courseAccess && (await activeExamContainsQuestion(req.auth.sub, q.id))) {
      return res.status(409).json({ error: 'Cette question appartient à votre examen civique en cours. Répondez-y depuis l’écran d’examen.', code: 'ACTIVE_EXAM_QUESTION' });
    }
    if (!courseAccess) {
      try {await ensureQuestionAccess(req.auth.sub, q);}
      catch (error) {if (accessErrorResponse(res, error)) return;throw error;}
    }
  }

  const answer = await db.prepare('SELECT * FROM answers WHERE id = ? AND question_id = ?').get(answerId, q.id);
  if (!answer) return res.status(400).json({ error: 'Réponse invalide.' });
  const correct = await db.prepare('SELECT id,text FROM answers WHERE question_id = ? AND is_correct = 1').get(q.id);

  let updatedAccess = null;
  if (req.auth?.sub && !courseAccess) {
    try {
      updatedAccess = await recordDailyQuestionAttempt(req.auth.sub, q, answer.id, Boolean(answer.is_correct), attemptSource);
    } catch (error) {
      if (accessErrorResponse(res, error)) return;
      throw error;
    }
  }

  if (courseAccess) {
    await db.prepare(`INSERT INTO course_question_attempts (user_id,course_id,question_id,answer_id,correct,answered_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(user_id,course_id,question_id) DO UPDATE SET
        answer_id=excluded.answer_id,correct=excluded.correct,answered_at=excluded.answered_at`).
    run(req.auth.sub, courseId, q.id, answer.id, answer.is_correct ? 1 : 0, now());
  }

  res.json({
    correct: Boolean(answer.is_correct),
    correctAnswerId: correct.id,
    correctAnswerText: correct.text,
    explanation: q.explanation,
    ...(courseAccess ? { courseAttemptRecorded: true } : {}),
    ...(req.auth?.sub ? { access: updatedAccess || (await getAccessSummary(req.auth.sub)) } : { guestPreview: true })
  });
});

// ---------------- PROGRESS / LEITNER ----------------
const reviewIntervalsDays = [0, 1, 3, 7, 14, 30];
function nextReviewIso(box) {
  const d = new Date();
  d.setDate(d.getDate() + reviewIntervalsDays[box]);
  return d.toISOString();
}

app.get('/api/progress', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT p.*, q.category, q.prompt
    FROM progress p JOIN questions q ON q.id = p.question_id
    WHERE p.user_id = ?
    ORDER BY COALESCE(p.next_review_at, '') ASC
  `).all(req.auth.sub);
  res.json({ progress: rows });
});

app.post('/api/progress/answer', requireAuth, async (req, res) => {
  const questionId = String(req.body?.questionId || '');
  const courseId = String(req.body?.courseId || '').trim();
  const answerId = String(req.body?.answerId || '').trim();
  if (!answerId) return res.status(400).json({ error: 'Réponse manquante.' });

  const question = await db.prepare("SELECT * FROM questions WHERE id=? AND is_active=1 AND status='published'").get(questionId);
  if (!question) return res.status(404).json({ error: 'Question introuvable.' });
  const courseAccess = Boolean(courseId && (await learnerHasCourseQuestion(req.auth.sub, courseId, questionId)));
  if (courseId && !courseAccess) return res.status(403).json({ error: 'Cours non affecté ou question absente du cours.' });

  const existing = await db.prepare('SELECT * FROM progress WHERE user_id = ? AND question_id = ?').get(req.auth.sub, questionId);
  if (!existing && !courseAccess) {
    try {await ensureQuestionAccess(req.auth.sub, question);}
    catch (error) {if (accessErrorResponse(res, error)) return;throw error;}
  }

  const chosen = await db.prepare('SELECT id,is_correct FROM answers WHERE id=? AND question_id=?').get(answerId, questionId);
  if (!chosen) return res.status(400).json({ error: 'Réponse invalide.' });
  const correct = Boolean(chosen.is_correct);

  let box = existing?.box || 1;
  let correctCount = existing?.correct_count || 0;
  let wrongCount = existing?.wrong_count || 0;
  if (correct) {box = Math.min(5, box + 1);correctCount += 1;} else
  {box = 1;wrongCount += 1;}
  const lastReviewedAt = now();
  const nextReviewAt = nextReviewIso(box);
  await db.prepare(`INSERT INTO progress (user_id,question_id,box,correct_count,wrong_count,last_reviewed_at,next_review_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id,question_id) DO UPDATE SET
      box=excluded.box, correct_count=excluded.correct_count, wrong_count=excluded.wrong_count,
      last_reviewed_at=excluded.last_reviewed_at, next_review_at=excluded.next_review_at`).
  run(req.auth.sub, questionId, box, correctCount, wrongCount, lastReviewedAt, nextReviewAt);
  res.json({
    progress: { questionId, box, correctCount, wrongCount, lastReviewedAt, nextReviewAt, correct },
    access: await getAccessSummary(req.auth.sub)
  });
});

app.post('/api/progress/import', requireAuth, async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  const questionStmt = db.prepare("SELECT * FROM questions WHERE id=? AND is_active=1 AND status='published'");
  const stmt = db.prepare(`INSERT INTO progress (user_id,question_id,box,correct_count,wrong_count,last_reviewed_at,next_review_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id,question_id) DO UPDATE SET
      box=excluded.box, correct_count=excluded.correct_count, wrong_count=excluded.wrong_count,
      last_reviewed_at=excluded.last_reviewed_at, next_review_at=excluded.next_review_at`);
  let imported = 0;
  let skippedLocked = 0;
  for (const e of entries.slice(0, 10000)) {
    if (!e.questionId) continue;
    const question = await questionStmt.get(e.questionId);
    if (!question) continue;
    const allowed = hasUnlimitedQuestionAccess(user, question) || (await questionAlreadyUnlocked(req.auth.sub, question.id));
    if (!allowed) {
      skippedLocked++;
      continue;
    }
    await stmt.run(
      req.auth.sub,
      e.questionId,
      clamp(Number(e.box || 1), 1, 5),
      Math.max(0, Number(e.correctCount || 0)),
      Math.max(0, Number(e.wrongCount || 0)),
      e.lastReviewedAt || null,
      e.nextReviewAt || null
    );
    imported++;
  }
  res.json({ imported, skippedLocked, access: await getAccessSummary(req.auth.sub) });
});

// ---------------- CIVIC EXAM ----------------
async function civicExamSettings() {
  const raw = Object.fromEntries((await db.prepare("SELECT key,value FROM app_settings WHERE key LIKE 'exam_%'").all()).map((r) => [r.key, r.value]));
  const number = (key, fallback, min, max) => {
    const value = Number(raw[key] ?? fallback);
    return Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
  };
  const percentage = Number(raw.exam_pass_percentage ?? 80);
  return {
    knowledgeCount: number('exam_knowledge_count', 28, 1, 200),
    scenarioCount: number('exam_scenario_count', 12, 0, 200),
    durationMinutes: number('exam_duration_minutes', 45, 1, 240),
    passPercentage: Number.isFinite(percentage) ? clamp(percentage, 1, 100) : 80
  };
}
function serializeExamSession(session, questions, { resumed = false } = {}) {
  const createdAt = new Date(session.created_at).getTime();
  const elapsed = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  const remaining = Math.max(0, Number(session.duration_seconds || 2700) - elapsed);
  return {
    id: session.id,
    durationSeconds: remaining,
    originalDurationSeconds: Number(session.duration_seconds || 2700),
    passPercentage: Number(session.pass_percentage || 80),
    questions,
    resumed
  };
}
async function loadExamSessionQuestions(session) {
  let ids = [];
  try { ids = JSON.parse(session.question_ids_json || '[]'); } catch { ids = []; }
  const get = db.prepare("SELECT * FROM questions WHERE id=? AND is_civic=1");
  const rows = (await Promise.all(ids.map(async qid => await get.get(qid)))).filter(Boolean);
  return Promise.all(rows.map(q => mapQuestion(q)));
}

app.get('/api/exams/civic/config', async (req, res) => {
  const settings = await civicExamSettings();
  const activeSession = req.auth?.sub ? Boolean(await db.prepare(`SELECT 1 FROM exam_sessions
    WHERE user_id=? AND submitted_at IS NULL AND expires_at>? LIMIT 1`).get(req.auth.sub, now())) : false;
  res.json({ config: { totalQuestions: settings.knowledgeCount + settings.scenarioCount, ...settings, activeSession } });
});

app.get('/api/exams/civic', requireAuth, async (req, res) => {
  const active = await db.prepare(`SELECT * FROM exam_sessions
    WHERE user_id=? AND submitted_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1`).get(req.auth.sub, now());
  if (active) {
    const questions = await loadExamSessionQuestions(active);
    if (questions.length) return res.json({ exam: serializeExamSession(active, questions, { resumed: true }) });
  }

  try {await assertCivicMockAvailable(req.auth.sub);}
  catch (error) {if (accessErrorResponse(res, error)) return;throw error;}

  const settings = await civicExamSettings();
  const knowledge = shuffle(await db.prepare("SELECT * FROM questions WHERE is_active = 1 AND status='published' AND is_civic = 1 AND question_type = 'knowledge'").all()).slice(0, settings.knowledgeCount);
  const scenarios = shuffle(await db.prepare("SELECT * FROM questions WHERE is_active = 1 AND status='published' AND is_civic = 1 AND question_type = 'scenario'").all()).slice(0, settings.scenarioCount);
  if (knowledge.length < settings.knowledgeCount || scenarios.length < settings.scenarioCount) {
    return res.status(503).json({ error: `La banque civique doit contenir au moins ${settings.knowledgeCount} questions de connaissance et ${settings.scenarioCount} mises en situation.` });
  }

  const selected = shuffle([...knowledge, ...scenarios]);
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  const accessPlan = getActivePlan(user) || 'free';
  const session = {
    id: id(),
    user_id: req.auth.sub,
    question_ids_json: JSON.stringify(selected.map((q) => q.id)),
    access_plan: accessPlan,
    duration_seconds: settings.durationMinutes * 60,
    pass_percentage: settings.passPercentage,
    // two-minute server grace prevents network latency from invalidating a client auto-submit
    expires_at: new Date(Date.now() + (settings.durationMinutes * 60 + 120) * 1000).toISOString(),
    submitted_at: null,
    created_at: now()
  };
  await db.prepare(`INSERT INTO exam_sessions
    (id,user_id,question_ids_json,access_plan,duration_seconds,pass_percentage,expires_at,submitted_at,created_at)
    VALUES (?,?,?,?,?,?,?,NULL,?)`).
  run(session.id, session.user_id, session.question_ids_json, session.access_plan, session.duration_seconds, session.pass_percentage, session.expires_at, session.created_at);

  const questions = await Promise.all(selected.map(q => mapQuestion(q)));
  res.json({ exam: serializeExamSession(session, questions), access: await getAccessSummary(req.auth.sub) });
});

app.post('/api/exams/submit', requireAuth, async (req, res) => {
  const examId = String(req.body?.examId || '').trim();
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (!examId) return res.status(400).json({ error: 'Session d’examen manquante.' });

  const session = await db.prepare('SELECT * FROM exam_sessions WHERE id=? AND user_id=?').get(examId, req.auth.sub);
  if (!session) return res.status(404).json({ error: 'Session d’examen introuvable.' });
  if (session.submitted_at) return res.status(409).json({ error: 'Cet examen a déjà été remis.', code: 'EXAM_ALREADY_SUBMITTED' });
  if (new Date(session.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'La session d’examen a expiré.', code: 'EXAM_EXPIRED' });

  let expectedIds = [];
  try {expectedIds = JSON.parse(session.question_ids_json || '[]');} catch {expectedIds = [];}
  if (!expectedIds.length) return res.status(500).json({ error: 'La session d’examen est invalide.' });
  if (answers.length !== expectedIds.length) {
    return res.status(400).json({ error: `La copie doit contenir exactement ${expectedIds.length} réponses, y compris les questions laissées sans réponse.` });
  }

  const byQuestion = new Map();
  for (const item of answers) {
    const questionId = String(item?.questionId || '');
    if (!expectedIds.includes(questionId) || byQuestion.has(questionId)) {
      return res.status(400).json({ error: 'La copie contient une question invalide ou dupliquée.' });
    }
    byQuestion.set(questionId, item?.answerId ? String(item.answerId) : null);
  }
  if (expectedIds.some((qid) => !byQuestion.has(qid))) {
    return res.status(400).json({ error: 'La copie est incomplète.' });
  }

  let score = 0;
  const breakdown = {};
  const details = [];
  for (const questionId of expectedIds) {
    const q = await db.prepare("SELECT * FROM questions WHERE id=? AND is_civic=1").get(questionId);
    if (!q) return res.status(409).json({ error: 'Une question de cet examen n’est plus disponible. Contactez un administrateur.' });
    const answerId = byQuestion.get(questionId);
    const chosen = answerId ? await db.prepare('SELECT * FROM answers WHERE id=? AND question_id=?').get(answerId, q.id) : null;
    if (answerId && !chosen) return res.status(400).json({ error: 'Une réponse sélectionnée est invalide.' });
    const correct = Boolean(chosen?.is_correct);
    if (correct) score++;
    const theme = q.civic_theme || q.category;
    breakdown[theme] ||= { correct: 0, total: 0 };
    breakdown[theme].total++;
    if (correct) breakdown[theme].correct++;
    details.push({ questionId: q.id, answerId: chosen?.id || null, correct });
  }

  const total = expectedIds.length;
  const percentage = total ? Math.round(score / total * 1000) / 10 : 0;
  const passPercentage = Number(session.pass_percentage || 80);
  const passed = percentage >= passPercentage;
  const breakdownPercent = Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, { ...v, percentage: Math.round(v.correct / v.total * 100) }]));
  const attemptId = id();

  await db.exec('BEGIN');
  try {
    await db.prepare('INSERT INTO exam_attempts (id,user_id,score,total,percentage,passed,breakdown_json,answers_json,access_plan,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').
    run(attemptId, req.auth.sub, score, total, percentage, passed ? 1 : 0, JSON.stringify(breakdownPercent), JSON.stringify(details), session.access_plan || 'free', now());
    await db.prepare('UPDATE exam_sessions SET submitted_at=? WHERE id=?').run(now(), session.id);
    await db.exec('COMMIT');
  } catch (error) {
    try {await db.exec('ROLLBACK');} catch {}
    throw error;
  }

  res.json({
    result: { id: attemptId, examId: session.id, score, total, percentage, passed, breakdown: breakdownPercent },
    access: await getAccessSummary(req.auth.sub)
  });
});

app.get('/api/exams/history', requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT id,score,total,percentage,passed,breakdown_json,created_at FROM exam_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 30').all(req.auth.sub);
  res.json({ attempts: rows.map((r) => ({ ...r, passed: Boolean(r.passed), breakdown: JSON.parse(r.breakdown_json) })) });
});

// ---------------- PREMIUM / STRIPE / ACCESS CODES ----------------
const plans = Object.fromEntries(
  Object.entries(stripePlans).map(([key, plan]) => [key, {
    label: plan.label,
    amountCents: plan.amountCents,
    days: plan.fallbackDays,
    mode: plan.mode
  }])
);

function subscriptionPeriodEnd(subscription) {
  const candidates = [
  subscription?.current_period_end,
  ...(Array.isArray(subscription?.items?.data) ? subscription.items.data.map((item) => item?.current_period_end) : [])].
  map(Number).filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

function premiumUntilFromEpoch(seconds) {
  if (!seconds) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

async function activatePlan(userId, planKey, premiumUntilOverride = undefined, stripeSubscriptionId = undefined, stripeCustomerId = undefined) {
  const plan = plans[planKey];
  if (!plan) throw new Error('Unknown plan');
  const until = premiumUntilOverride !== undefined ?
  premiumUntilOverride :
  plan.days ?
  new Date(Date.now() + plan.days * 86400000).toISOString() :
  null;

  const user = await db.prepare('SELECT stripe_subscription_id,stripe_customer_id FROM users WHERE id=?').get(userId);
  await db.prepare(`UPDATE users SET
      premium_plan = ?, premium_until = ?, stripe_subscription_id = ?, stripe_customer_id = ?
      WHERE id = ?`).
  run(
    planKey,
    until,
    stripeSubscriptionId !== undefined ? stripeSubscriptionId : user?.stripe_subscription_id || null,
    stripeCustomerId !== undefined ? stripeCustomerId : user?.stripe_customer_id || null,
    userId
  );
  return { plan: planKey, premiumUntil: until };
}

async function clearSubscriptionEntitlement(userId, subscriptionId) {
  const user = await db.prepare('SELECT premium_plan,stripe_subscription_id FROM users WHERE id=?').get(userId);
  if (!user || subscriptionId && user.stripe_subscription_id && user.stripe_subscription_id !== subscriptionId) return;
  if (!['monthly', 'annual'].includes(user.premium_plan)) {
    await db.prepare('UPDATE users SET stripe_subscription_id=NULL WHERE id=?').run(userId);
    return;
  }
  await db.prepare('UPDATE users SET premium_plan=NULL,premium_until=NULL,stripe_subscription_id=NULL WHERE id=?').run(userId);
}

async function ensureStripeCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await createStripeCustomer({ email: user.email, name: user.name, userId: user.id });
  await db.prepare('UPDATE users SET stripe_customer_id=? WHERE id=?').run(customer.id, user.id);
  return customer.id;
}

async function recordStripePayment({ userId, planKey, status, session = {}, subscriptionId = null }) {
  const existing = session.id ? await
  db.prepare('SELECT id FROM payments WHERE stripe_session_id=?').get(session.id) :
  null;
  const plan = plans[planKey];
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const subId = subscriptionId || (typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null);
  if (existing) {
    await db.prepare(`UPDATE payments SET status=?,stripe_payment_intent_id=?,stripe_subscription_id=?,updated_at=? WHERE id=?`).
    run(status, paymentIntentId, subId, now(), existing.id);
    return existing.id;
  }
  const paymentId = id();
  await db.prepare(`INSERT INTO payments
    (id,user_id,plan,amount_cents,mode,status,stripe_session_id,stripe_payment_intent_id,stripe_subscription_id,updated_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).
  run(paymentId, userId, planKey, plan?.amountCents || 0, 'stripe', status, session.id || null, paymentIntentId, subId, now(), now());
  return paymentId;
}

async function applyStripeSubscription(subscription, fallbackUserId = null, fallbackPlan = null) {
  if (!subscription) return null;
  const subscriptionId = subscription.id;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null;
  const metadata = subscription.metadata || {};
  const userId = metadata.user_id || fallbackUserId || (await db.prepare('SELECT id FROM users WHERE stripe_subscription_id=? OR stripe_customer_id=?').get(subscriptionId, customerId))?.id;
  const planKey = metadata.plan || fallbackPlan || (await db.prepare('SELECT premium_plan FROM users WHERE id=?').get(userId))?.premium_plan;
  if (!userId || !plans[planKey]) return null;

  if (['active', 'trialing', 'past_due'].includes(subscription.status)) {
    const until = premiumUntilFromEpoch(subscriptionPeriodEnd(subscription));
    return await activatePlan(userId, planKey, until, subscriptionId, customerId || undefined);
  }
  if (['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status)) {
    await clearSubscriptionEntitlement(userId, subscriptionId);
  }
  return null;
}

async function processStripeCheckoutSession(session) {
  const metadata = session?.metadata || {};
  const userId = metadata.user_id || session?.client_reference_id;
  const planKey = metadata.plan;
  if (!userId || !plans[planKey]) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) return null;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;

  if (session.mode === 'subscription') {
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subscriptionId) return null;
    const subscription = typeof session.subscription === 'object' && session.subscription?.current_period_end ?
    session.subscription :
    await retrieveSubscription(subscriptionId);
    const entitlement = await applyStripeSubscription(subscription, userId, planKey);
    await recordStripePayment({ userId, planKey, status: 'paid', session, subscriptionId });
    if (customerId && !user.stripe_customer_id) await db.prepare('UPDATE users SET stripe_customer_id=? WHERE id=?').run(customerId, userId);
    return entitlement;
  }

  if (session.payment_status !== 'paid') {
    await recordStripePayment({ userId, planKey, status: session.payment_status || 'pending', session });
    return null;
  }

  const entitlement = await activatePlan(userId, planKey, undefined, null, customerId || undefined);
  await recordStripePayment({ userId, planKey, status: 'paid', session });
  return entitlement;
}

async function handleStripeWebhook(req, res) {
  try {
    verifyStripeWebhookSignature(req.body, req.headers['stripe-signature']);
    const event = JSON.parse(req.body.toString('utf8'));
    if (await db.prepare('SELECT event_id FROM stripe_events WHERE event_id=?').get(event.id)) {
      return res.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await processStripeCheckoutSession(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await applyStripeSubscription(event.data.object);
        break;
      case 'customer.subscription.deleted':{
          const subscription = event.data.object;
          const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null;
          const userId = subscription.metadata?.user_id || (await db.prepare('SELECT id FROM users WHERE stripe_subscription_id=? OR stripe_customer_id=?').get(subscription.id, customerId))?.id;
          if (userId) await clearSubscriptionEntitlement(userId, subscription.id);
          break;
        }
      case 'invoice.paid':{
          const subscriptionId = typeof event.data.object.subscription === 'string' ? event.data.object.subscription : event.data.object.subscription?.id;
          if (subscriptionId) await applyStripeSubscription(await retrieveSubscription(subscriptionId));
          break;
        }
      default:
        break;
    }

    await db.prepare('INSERT INTO stripe_events (event_id,type,created_at) VALUES (?,?,?)').run(event.id, event.type, now());
    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(400).json({ error: error.message || 'Webhook Stripe invalide.' });
  }
}

app.get('/api/payments/plans', (_req, res) => {
  res.json({
    mode: config.paymentsMode,
    stripeConfigured: stripeConfigured(),
    plans: Object.fromEntries(Object.entries(stripePlans).map(([key, plan]) => [key, {
      label: plan.label,
      amountCents: plan.amountCents,
      paymentMode: plan.mode,
      priceConfigured: Boolean(plan.priceId())
    }]))
  });
});

app.post('/api/payments/checkout', requireAuth, async (req, res) => {
  const planKey = String(req.body?.plan || '');
  const plan = plans[planKey];
  if (!plan) return res.status(400).json({ error: 'Offre inconnue.' });

  const checkoutUser = await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  if (!checkoutUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const currentAccess = await getAccessSummary(checkoutUser);
  if (checkoutUser.role !== 'learner') {
    return res.status(400).json({ error: 'Les comptes formateur et administrateur disposent déjà des accès nécessaires.' });
  }
  if (currentAccess?.plan && currentAccess.plan !== 'free') {
    return res.status(409).json({
      error: `Vous avez déjà une offre active (${currentAccess.plan}). Gérez ou terminez cette offre avant d’en acheter une autre.`,
      code: 'ACTIVE_PLAN_EXISTS',
      access: currentAccess
    });
  }

  if (config.paymentsMode === 'demo') {
    const entitlement = await activatePlan(req.auth.sub, planKey);
    await db.prepare(`INSERT INTO payments (id,user_id,plan,amount_cents,mode,status,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?)`).
    run(id(), req.auth.sub, planKey, plan.amountCents, 'demo', 'paid', now(), now());
    return res.json({ demo: true, message: 'Paiement de démonstration validé.', entitlement });
  }

  if (config.paymentsMode !== 'stripe') return res.status(503).json({ error: 'Le mode de paiement doit être « stripe » ou « demo ».' });
  if (!stripeConfigured()) return res.status(503).json({ error: 'Stripe n’est pas configuré côté serveur.' });

  try {
    const user = checkoutUser;
    const customerId = await ensureStripeCustomer(user);
    const session = await createCheckoutSession({ planKey, user, customerId });
    res.json({ stripe: true, url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(502).json({ error: error.message || 'Impossible d’ouvrir le paiement Stripe.' });
  }
});

app.get('/api/payments/checkout/session/:sessionId', requireAuth, async (req, res) => {
  if (config.paymentsMode !== 'stripe' || !stripeConfigured()) return res.status(400).json({ error: 'Stripe n’est pas actif.' });
  try {
    const session = await retrieveCheckoutSession(req.params.sessionId);
    const ownerId = session.metadata?.user_id || session.client_reference_id;
    if (ownerId !== req.auth.sub) return res.status(403).json({ error: 'Cette session de paiement ne vous appartient pas.' });
    const entitlement = await processStripeCheckoutSession(session);
    const user = sanitizeUser(await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub));
    res.json({
      status: session.payment_status || session.status,
      complete: session.status === 'complete',
      entitlement,
      user
    });
  } catch (error) {
    console.error('Stripe checkout confirmation error:', error);
    res.status(502).json({ error: error.message || 'Impossible de confirmer le paiement Stripe.' });
  }
});

app.post('/api/payments/portal', requireAuth, async (req, res) => {
  if (config.paymentsMode !== 'stripe' || !stripeConfigured()) return res.status(400).json({ error: 'Stripe n’est pas actif.' });
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
    const customerId = await ensureStripeCustomer(user);
    const session = await createBillingPortalSession({ customerId });
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe portal error:', error);
    res.status(502).json({ error: error.message || 'Impossible d’ouvrir le portail de facturation.' });
  }
});

app.post('/api/access-codes/redeem', requireAuth, async (req, res) => {
  const current = await getAccessSummary(req.auth.sub);
  if (current?.plan && current.plan !== 'free') {
    return res.status(409).json({
      error: `Une offre est déjà active (${current.plan}).`,
      code: 'ACTIVE_PLAN_EXISTS',
      access: current
    });
  }
  const codeText = String(req.body?.code || '').trim().toUpperCase();
  if (codeText === 'CALA-DEMO-2026' && !config.demoAccessCodeEnabled) {
    return res.status(404).json({ error: 'Code invalide.' });
  }
  const code = await db.prepare('SELECT * FROM access_codes WHERE code = ?').get(codeText);
  if (!code) return res.status(404).json({ error: 'Code invalide.' });
  if (code.expires_at && new Date(code.expires_at) < new Date()) return res.status(400).json({ error: 'Ce code a expiré.' });
  if (code.uses >= code.max_uses) return res.status(400).json({ error: 'Ce code a atteint sa limite d’utilisation.' });
  const claim = await db.prepare('UPDATE access_codes SET uses = uses + 1 WHERE id = ? AND uses < max_uses').run(code.id);
  if (!claim.changes) return res.status(400).json({ error: 'Ce code a atteint sa limite d’utilisation.' });
  const entitlement = await activatePlan(req.auth.sub, code.plan);
  res.json({ message: 'Accès activé.', entitlement });
});

// ---------------- TRAINER ----------------
app.get('/api/trainer/cohorts', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const rows = req.auth.role === 'admin' ? await
  db.prepare(`SELECT c.*, i.name AS institution_name, u.name AS trainer_name,
        (SELECT COUNT(*) FROM cohort_members cm WHERE cm.cohort_id = c.id) AS learner_count
        FROM cohorts c JOIN institutions i ON i.id=c.institution_id JOIN users u ON u.id=c.trainer_id ORDER BY c.created_at DESC`).all() : await
  db.prepare(`SELECT c.*, i.name AS institution_name, u.name AS trainer_name,
        (SELECT COUNT(*) FROM cohort_members cm WHERE cm.cohort_id = c.id) AS learner_count
        FROM cohorts c JOIN institutions i ON i.id=c.institution_id JOIN users u ON u.id=c.trainer_id
        WHERE c.trainer_id = ? ORDER BY c.created_at DESC`).all(req.auth.sub);
  res.json({ cohorts: rows });
});

app.get('/api/trainer/cohorts/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const cohort = await db.prepare('SELECT * FROM cohorts WHERE id = ?').get(req.params.id);
  if (!cohort || req.auth.role !== 'admin' && cohort.trainer_id !== req.auth.sub) return res.status(404).json({ error: 'Groupe introuvable.' });
  const members = await db.prepare(`
    SELECT u.id,u.name,u.email,u.premium_plan,
      COUNT(p.question_id) AS questions_reviewed,
      COALESCE(SUM(p.correct_count),0) AS correct_count,
      COALESCE(SUM(p.wrong_count),0) AS wrong_count,
      COALESCE(AVG(p.box),0) AS avg_box
    FROM cohort_members cm JOIN users u ON u.id=cm.user_id
    LEFT JOIN progress p ON p.user_id=u.id
    WHERE cm.cohort_id=? GROUP BY u.id ORDER BY u.name
  `).all(cohort.id);
  res.json({ cohort, members });
});

app.post('/api/trainer/cohorts', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom du groupe requis.' });
  let institution = await db.prepare('SELECT * FROM institutions ORDER BY created_at LIMIT 1').get();
  if (!institution) {
    institution = { id: id(), name: 'Établissement Calamelle', created_at: now() };
    await db.prepare('INSERT INTO institutions (id,name,created_at) VALUES (?,?,?)').run(institution.id, institution.name, institution.created_at);
  }
  const cohort = { id: id(), institution_id: institution.id, trainer_id: req.auth.sub, name, created_at: now() };
  await db.prepare('INSERT INTO cohorts (id,institution_id,trainer_id,name,created_at) VALUES (?,?,?,?,?)').run(cohort.id, cohort.institution_id, cohort.trainer_id, cohort.name, cohort.created_at);
  res.status(201).json({ cohort });
});

app.post('/api/trainer/cohorts/:id/members', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const cohort = await db.prepare('SELECT * FROM cohorts WHERE id = ?').get(req.params.id);
  if (!cohort || req.auth.role !== 'admin' && cohort.trainer_id !== req.auth.sub) return res.status(404).json({ error: 'Groupe introuvable.' });
  const email = normalizeEmail(req.body?.email);
  const user = await db.prepare("SELECT id,name,email FROM users WHERE email=? AND role='learner' AND status='active'").get(email);
  if (!user) return res.status(404).json({ error: 'Aucun apprenant trouvé avec cet e-mail.' });
  await db.prepare('INSERT INTO cohort_members (cohort_id,user_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(cohort.id, user.id);
  res.json({ member: user });
});

// ---------------- ADMIN ----------------
app.get('/api/admin/questions', requireAuth, requireRole('admin'), async (req, res) => {
  const limit = clamp(Number(req.query.limit || 100), 1, 500);
  const rows = await db.prepare('SELECT * FROM questions ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json({ questions: await Promise.all(rows.map(q => mapQuestion(q, null, true))) });
});

app.post('/api/admin/questions', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  if (!body.prompt || !body.explanation || !body.category || !Array.isArray(body.answers) || body.answers.length < 2) {
    return res.status(400).json({ error: 'Question, explication, catégorie et au moins deux réponses sont requises.' });
  }
  const qid = await insertQuestion({
    prompt: String(body.prompt), explanation: String(body.explanation), category: String(body.category),
    difficulty: String(body.difficulty || 'Apprenti'), civicTheme: body.civicTheme ? String(body.civicTheme) : null,
    questionType: String(body.questionType || 'knowledge'), isCivic: Boolean(body.isCivic),
    answers: body.answers.map(String), correctIndex: clamp(Number(body.correctIndex || 0), 0, body.answers.length - 1)
  });
  const q = await db.prepare('SELECT * FROM questions WHERE id=?').get(qid);
  res.status(201).json({ question: await mapQuestion(q, null, true) });
});

app.put('/api/admin/questions/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  const existing = await db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Question introuvable.' });
  await db.prepare(`UPDATE questions SET prompt=?,explanation=?,category=?,difficulty=?,civic_theme=?,question_type=?,is_civic=?,updated_at=? WHERE id=?`).
  run(String(body.prompt || existing.prompt), String(body.explanation || existing.explanation), String(body.category || existing.category), String(body.difficulty || existing.difficulty), body.civicTheme ?? existing.civic_theme, String(body.questionType || existing.question_type), body.isCivic === undefined ? existing.is_civic : body.isCivic ? 1 : 0, now(), existing.id);
  if (Array.isArray(body.answers) && body.answers.length >= 2) {
    await db.prepare('DELETE FROM answers WHERE question_id=?').run(existing.id);
    const stmt = db.prepare('INSERT INTO answers (id,question_id,text,is_correct) VALUES (?,?,?,?)');
    const ci = clamp(Number(body.correctIndex || 0), 0, body.answers.length - 1);
    for (let idx = 0; idx < body.answers.length; idx += 1) {
      await stmt.run(id(), existing.id, String(body.answers[idx]), idx === ci ? 1 : 0);
    }
  }
  const q = await db.prepare('SELECT * FROM questions WHERE id=?').get(existing.id);
  res.json({ question: await mapQuestion(q, null, true) });
});

app.delete('/api/admin/questions/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const info = await db.prepare('UPDATE questions SET is_active=0,updated_at=? WHERE id=?').run(now(), req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Question introuvable.' });
  res.status(204).end();
});

app.post('/api/admin/questions/import', requireAuth, requireRole('admin'), async (req, res) => {
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (!questions.length) return res.status(400).json({ error: 'Aucune question à importer.' });
  let imported = 0;
  const errors = [];
  const importRows = questions.slice(0, 5000);
  for (let index = 0; index < importRows.length; index += 1) {
    try {
      await insertQuestion(importRows[index]);
      imported++;
    } catch (e) {
      errors.push({ row: index + 1, error: e.message });
    }
  }
  res.json({ imported, errors: errors.slice(0, 50) });
});

app.get('/api/admin/stats', requireAuth, requireRole('admin'), async (_req, res) => {
  const getCount = async (table) => Number((await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get())?.c || 0);
  res.json({
    stats: {
      users: await getCount('users'),
      questions: Number((await db.prepare('SELECT COUNT(*) AS c FROM questions WHERE is_active=1').get())?.c || 0),
      pending: Number((await db.prepare("SELECT COUNT(*) AS c FROM questions WHERE is_active=1 AND status='pending'").get())?.c || 0),
      courses: await getCount('courses'),
      cohorts: await getCount('cohorts'),
      exams: await getCount('exam_attempts'),
      payments: await getCount('payments')
    }
  });
});

// ---------------- LEARNER COURSES ----------------
async function getCourseResultSummary(userId, courseId) {
  const total = Number((await db.prepare(`SELECT COUNT(*) AS c FROM course_questions cq JOIN questions q ON q.id=cq.question_id
    WHERE cq.course_id=? AND q.is_active=1 AND q.status='published'`).get(courseId))?.c || 0);
  const row = (await db.prepare(`SELECT COUNT(*) AS attempted, COALESCE(SUM(CASE WHEN cqa.correct=1 THEN 1 ELSE 0 END),0) AS correct
    FROM course_question_attempts cqa JOIN questions q ON q.id=cqa.question_id
    WHERE cqa.user_id=? AND cqa.course_id=? AND q.is_active=1 AND q.status='published'`).get(userId, courseId)) || {};
  const attempted = Number(row.attempted || 0);
  const correct = Number(row.correct || 0);
  const incorrect = Math.max(0, attempted - correct);
  const percentage = attempted ? Math.round(correct / attempted * 100) : 0;
  return { total, attempted, correct, incorrect, percentage };
}
app.get('/api/learner/courses', requireAuth, async (req, res) => {
  if (req.auth.role !== 'learner') return res.json({ courses: [] });
  const rows = await db.prepare(`SELECT DISTINCT c.*,
    (SELECT COUNT(*) FROM course_questions cq JOIN questions q ON q.id=cq.question_id
      WHERE cq.course_id=c.id AND q.is_active=1 AND q.status='published') question_count,
    (SELECT COUNT(*) FROM course_question_attempts cqa WHERE cqa.course_id=c.id AND cqa.user_id=?) attempted_count,
    EXISTS(SELECT 1 FROM course_completions cco WHERE cco.course_id=c.id AND cco.user_id=?) completed,
    co.name AS cohort_name
    FROM courses c
    JOIN course_cohorts cc ON cc.course_id=c.id
    JOIN cohorts co ON co.id=cc.cohort_id
    JOIN cohort_members cm ON cm.cohort_id=co.id
    WHERE cm.user_id=? AND c.status='published'
    ORDER BY c.updated_at DESC`).all(req.auth.sub, req.auth.sub, req.auth.sub);
  res.json({ courses: rows.map((row) => ({ ...row, completed: Boolean(row.completed) })) });
});

app.get('/api/learner/courses/:id', requireAuth, async (req, res) => {
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Espace réservé aux apprenants.' });
  const course = await db.prepare(`SELECT DISTINCT c.* FROM courses c
    JOIN course_cohorts cc ON cc.course_id=c.id
    JOIN cohort_members cm ON cm.cohort_id=cc.cohort_id
    WHERE c.id=? AND cm.user_id=? AND c.status='published'`).get(req.params.id, req.auth.sub);
  if (!course) return res.status(404).json({ error: 'Cours introuvable ou non affecté.' });
  const questionRows = await db.prepare(`SELECT q.* FROM course_questions cq
    JOIN questions q ON q.id=cq.question_id
    WHERE cq.course_id=? AND q.is_active=1 AND q.status='published'
    ORDER BY cq.sort_order,q.prompt`).all(course.id);
  const questions = await Promise.all(questionRows.map(q => mapQuestion(q)));
  const attempts = await db.prepare(`SELECT question_id,answer_id,correct,answered_at FROM course_question_attempts
    WHERE user_id=? AND course_id=?`).all(req.auth.sub, course.id);
  const completed = Boolean(await db.prepare('SELECT 1 FROM course_completions WHERE user_id=? AND course_id=?').get(req.auth.sub, course.id));
  const result = await getCourseResultSummary(req.auth.sub, course.id);
  res.json({ course, questions, attempts, completed, result });
});

app.post('/api/learner/courses/:id/complete', requireAuth, async (req, res) => {
  if (req.auth.role !== 'learner') return res.status(403).json({ error: 'Espace réservé aux apprenants.' });
  const course = await db.prepare(`SELECT DISTINCT c.* FROM courses c
    JOIN course_cohorts cc ON cc.course_id=c.id
    JOIN cohort_members cm ON cm.cohort_id=cc.cohort_id
    WHERE c.id=? AND cm.user_id=? AND c.status='published'`).get(req.params.id, req.auth.sub);
  if (!course) return res.status(404).json({ error: 'Cours introuvable ou non affecté.' });
  const total = Number((await db.prepare(`SELECT COUNT(*) AS c FROM course_questions cq JOIN questions q ON q.id=cq.question_id
    WHERE cq.course_id=? AND q.is_active=1 AND q.status='published'`).get(course.id))?.c || 0);
  const attempted = Number((await db.prepare(`SELECT COUNT(*) AS c FROM course_question_attempts cqa
    JOIN questions q ON q.id=cqa.question_id
    WHERE cqa.user_id=? AND cqa.course_id=? AND q.is_active=1 AND q.status='published'`).get(req.auth.sub, course.id))?.c || 0);
  if (!total) return res.status(400).json({ error: 'Ce cours ne contient aucune question publiée.' });
  if (attempted < total) return res.status(409).json({ error: `Terminez les ${total - attempted} question(s) restante(s) avant de clôturer le cours.`, code: 'COURSE_INCOMPLETE' });
  const completedAt = now();
  await db.prepare(`INSERT INTO course_completions (user_id,course_id,completed_at) VALUES (?,?,?)
    ON CONFLICT(user_id,course_id) DO UPDATE SET completed_at=excluded.completed_at`).run(req.auth.sub, course.id, completedAt);
  const result = await getCourseResultSummary(req.auth.sub, course.id);
  res.json({ completed: true, completedAt, total, attempted, result });
});

// ---------------- MDM / CONTENT MANAGEMENT ----------------
function trainerCanAccessCohort(auth, cohort) {
  return Boolean(cohort && (auth.role === 'admin' || cohort.trainer_id === auth.sub));
}

function canEditManagedQuestion(auth, question) {
  if (!question) return false;
  if (auth.role === 'admin') return true;
  return auth.role === 'trainer' && question.status !== 'published';
}

async function managedQuestionReadyForWorkflow(questionId) {
  const q = await db.prepare('SELECT * FROM questions WHERE id=? AND is_active=1').get(questionId);
  if (!q) return { ok: false, error: 'Question introuvable.' };
  if (!String(q.prompt || '').trim()) return { ok: false, error: 'La question est obligatoire.' };
  if (!String(q.category || '').trim()) return { ok: false, error: 'Le module est obligatoire.' };
  if (!String(q.explanation || '').trim()) return { ok: false, error: 'Ajoutez une explication avant validation ou publication.' };
  if (q.is_civic && !String(q.civic_theme || '').trim()) return { ok: false, error: 'Choisissez le thème officiel de la question civique.' };
  const answers = await db.prepare('SELECT text,is_correct FROM answers WHERE question_id=?').all(questionId);
  if (answers.length < 2 || answers.some((a) => !String(a.text || '').trim())) return { ok: false, error: 'Complétez toutes les réponses avant validation ou publication.' };
  if (answers.filter((a) => a.is_correct).length !== 1) return { ok: false, error: 'Sélectionnez exactement une bonne réponse.' };
  return { ok: true };
}

app.get('/api/mdm', requireAuth, requireRole('trainer', 'admin'), async (_req, res) => {
  const modules = await db.prepare('SELECT * FROM mdm_modules WHERE active=1 ORDER BY sort_order,name').all();
  const themes = await db.prepare('SELECT * FROM mdm_themes WHERE active=1 ORDER BY module_code,sort_order,name').all();
  const levels = await db.prepare('SELECT * FROM mdm_levels WHERE active=1 ORDER BY sort_order,name').all();
  const questionTypes = await db.prepare('SELECT * FROM mdm_question_types WHERE active=1 ORDER BY sort_order,name').all();
  res.json({ modules, themes, levels, questionTypes });
});

app.get('/api/manage/questions', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const moduleName = req.query.module ? String(req.query.module) : null;
  const civic = req.query.civic === 'true' ? 1 : req.query.civic === 'false' ? 0 : null;
  const search = req.query.search ? String(req.query.search).trim() : '';
  const limit = clamp(Number(req.query.limit || 100), 1, 500);
  const where = ['q.is_active=1'];const params = [];
  if (status) {where.push('q.status=?');params.push(status);}
  if (moduleName) {where.push('q.category=?');params.push(moduleName);}
  if (civic !== null) {where.push('q.is_civic=?');params.push(civic);}
  if (search) {where.push('(q.prompt LIKE ? OR q.explanation LIKE ? OR q.category LIKE ? OR q.source_theme LIKE ?)');const term = `%${search}%`;params.push(term, term, term, term);}
  const rows = await db.prepare(`SELECT q.*, u.name AS author_name FROM questions q LEFT JOIN users u ON u.id=q.author_id WHERE ${where.join(' AND ')} ORDER BY q.updated_at DESC LIMIT ?`).all(...params, limit);
  res.json({ questions: await Promise.all(rows.map(async row => ({ ...(await mapQuestion(row, null, true)), authorName: row.author_name || null }))) });
});

app.get('/api/manage/questions/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const q = await db.prepare('SELECT * FROM questions WHERE id=? AND is_active=1').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question introuvable.' });
  res.json({ question: await mapQuestion(q, null, true) });
});

app.post('/api/manage/questions', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const body = req.body || {};
  const requestedStatus = req.auth.role === 'admin' && body.status === 'published' ? 'published' : body.status === 'pending' ? 'pending' : 'draft';
  try {
    const qid = await insertQuestion({ ...body, status: requestedStatus, authorId: req.auth.sub });
    const q = await db.prepare('SELECT * FROM questions WHERE id=?').get(qid);
    res.status(201).json({ question: await mapQuestion(q, null, true) });
  } catch (error) {res.status(400).json({ error: error.message });}
});

app.put('/api/manage/questions/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const existing = await db.prepare('SELECT * FROM questions WHERE id=? AND is_active=1').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Question introuvable.' });
  if (!canEditManagedQuestion(req.auth, existing)) return res.status(403).json({ error: 'Une question publiée doit être modifiée par un administrateur.' });

  const body = req.body || {};
  const prompt = String(body.prompt ?? existing.prompt).trim();
  const category = String(body.category ?? existing.category).trim();
  if (!prompt || !category) return res.status(400).json({ error: 'Question et module sont requis.' });
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => String(typeof a === 'string' ? a : a?.text ?? '')) : null;
  if (answers && answers.length < 2) return res.status(400).json({ error: 'Au moins deux réponses sont requises.' });
  const isCivic = body.isCivic === undefined ? Boolean(existing.is_civic) : Boolean(body.isCivic);
  const civicTheme = isCivic ? String(body.civicTheme ?? existing.civic_theme ?? '').trim() || null : null;
  const requestedStatus = String(body.status || existing.status || 'draft');
  const keepPublished = req.auth.role === 'admin' && existing.status === 'published' && requestedStatus === 'published';
  const nextStatus = keepPublished ? 'published' : 'draft';

  await db.exec('BEGIN');
  try {
    await db.prepare(`UPDATE questions SET
      prompt=?,explanation=?,category=?,difficulty=?,civic_theme=?,question_type=?,is_civic=?,source_module=?,source_theme=?,status=?,validated_by=?,validated_at=?,updated_at=?
      WHERE id=?`).
    run(
      prompt,
      String(body.explanation ?? existing.explanation),
      category,
      String(body.difficulty ?? existing.difficulty),
      civicTheme,
      String(body.questionType ?? existing.question_type),
      isCivic ? 1 : 0,
      String(body.sourceModule ?? existing.source_module ?? category),
      body.sourceTheme === undefined ? existing.source_theme : String(body.sourceTheme || '').trim() || null,
      nextStatus,
      keepPublished ? req.auth.sub : null,
      keepPublished ? now() : null,
      now(),
      existing.id
    );
    if (answers) {
      await db.prepare('DELETE FROM answers WHERE question_id=?').run(existing.id);
      const ci = clamp(Number(body.correctIndex ?? 0), 0, Math.max(0, answers.length - 1));
      const stmt = db.prepare('INSERT INTO answers (id,question_id,text,is_correct) VALUES (?,?,?,?)');
      for (let index = 0; index < answers.length; index += 1) {
        await stmt.run(id(), existing.id, answers[index], index === ci ? 1 : 0);
      }
    }
    if (keepPublished) {
      const readiness = await managedQuestionReadyForWorkflow(existing.id);
      if (!readiness.ok) throw new Error(readiness.error);
    }
    await db.exec('COMMIT');
  } catch (error) {
    try {await db.exec('ROLLBACK');} catch {}
    return res.status(400).json({ error: error.message || 'Impossible de modifier la question.' });
  }
  res.json({ question: await mapQuestion(await db.prepare('SELECT * FROM questions WHERE id=?').get(existing.id), null, true) });
});

app.delete('/api/manage/questions/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const q = await db.prepare('SELECT * FROM questions WHERE id=? AND is_active=1').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question introuvable.' });
  if (!canEditManagedQuestion(req.auth, q)) return res.status(403).json({ error: 'Suppression non autorisée.' });
  await db.prepare('UPDATE questions SET is_active=0,updated_at=? WHERE id=?').run(now(), q.id);
  res.status(204).end();
});

app.post('/api/manage/questions/:id/status', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const q = await db.prepare('SELECT * FROM questions WHERE id=? AND is_active=1').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question introuvable.' });
  const status = String(req.body?.status || '');
  const allowed = req.auth.role === 'admin' ? ['draft', 'pending', 'validated', 'published'] : ['draft', 'pending', 'validated'];
  if (!allowed.includes(status)) return res.status(403).json({ error: 'Transition de statut non autorisée.' });
  if (status !== 'draft') {
    const readiness = await managedQuestionReadyForWorkflow(q.id);
    if (!readiness.ok) return res.status(400).json({ error: readiness.error });
  }
  const validated = status === 'validated' || status === 'published';
  await db.prepare('UPDATE questions SET status=?,validated_by=?,validated_at=?,updated_at=? WHERE id=?').
  run(status, validated ? req.auth.sub : null, validated ? now() : null, now(), q.id);
  res.json({ question: await mapQuestion(await db.prepare('SELECT * FROM questions WHERE id=?').get(q.id), null, true) });
});

// ---------------- TRAINER: GROUPS / LEARNERS / COURSES ----------------
app.put('/api/trainer/cohorts/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const cohort = await db.prepare('SELECT * FROM cohorts WHERE id=?').get(req.params.id);
  if (!trainerCanAccessCohort(req.auth, cohort)) return res.status(404).json({ error: 'Groupe introuvable.' });
  const name = String(req.body?.name || cohort.name).trim();
  await db.prepare('UPDATE cohorts SET name=?,description=?,start_date=?,end_date=? WHERE id=?').run(name, req.body?.description ?? cohort.description, req.body?.startDate ?? cohort.start_date, req.body?.endDate ?? cohort.end_date, cohort.id);
  res.json({ cohort: await db.prepare('SELECT * FROM cohorts WHERE id=?').get(cohort.id) });
});

app.delete('/api/trainer/cohorts/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const cohort = await db.prepare('SELECT * FROM cohorts WHERE id=?').get(req.params.id);
  if (!trainerCanAccessCohort(req.auth, cohort)) return res.status(404).json({ error: 'Groupe introuvable.' });
  await db.prepare('DELETE FROM cohorts WHERE id=?').run(cohort.id);res.status(204).end();
});

app.delete('/api/trainer/cohorts/:id/members/:userId', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const cohort = await db.prepare('SELECT * FROM cohorts WHERE id=?').get(req.params.id);
  if (!trainerCanAccessCohort(req.auth, cohort)) return res.status(404).json({ error: 'Groupe introuvable.' });
  await db.prepare('DELETE FROM cohort_members WHERE cohort_id=? AND user_id=?').run(cohort.id, req.params.userId);res.status(204).end();
});

app.get('/api/trainer/learners', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const params = [];let trainerFilter = '';
  if (req.auth.role !== 'admin') {trainerFilter = 'AND c.trainer_id=?';params.push(req.auth.sub);}
  const rows = await db.prepare(`SELECT u.id,u.name,u.email,c.id AS cohort_id,c.name AS cohort_name, COUNT(p.question_id) questions_reviewed, COALESCE(SUM(p.correct_count),0) correct_count, COALESCE(SUM(p.wrong_count),0) wrong_count, COALESCE(AVG(p.box),0) avg_box FROM cohort_members cm JOIN cohorts c ON c.id=cm.cohort_id JOIN users u ON u.id=cm.user_id LEFT JOIN progress p ON p.user_id=u.id WHERE 1=1 ${trainerFilter} GROUP BY u.id,c.id ORDER BY u.name`).all(...params);
  res.json({ learners: rows });
});

function courseOwned(auth, course) {return Boolean(course && (auth.role === 'admin' || course.trainer_id === auth.sub));}

app.get('/api/trainer/courses', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const rows = req.auth.role === 'admin' ? await db.prepare(`SELECT c.*,u.name trainer_name,(SELECT COUNT(*) FROM course_questions cq JOIN questions q ON q.id=cq.question_id WHERE cq.course_id=c.id AND q.is_active=1 AND q.status='published') question_count,(SELECT COUNT(*) FROM course_cohorts cc WHERE cc.course_id=c.id) cohort_count FROM courses c JOIN users u ON u.id=c.trainer_id ORDER BY c.updated_at DESC`).all() : await db.prepare(`SELECT c.*,(SELECT COUNT(*) FROM course_questions cq JOIN questions q ON q.id=cq.question_id WHERE cq.course_id=c.id AND q.is_active=1 AND q.status='published') question_count,(SELECT COUNT(*) FROM course_cohorts cc WHERE cc.course_id=c.id) cohort_count FROM courses c WHERE trainer_id=? ORDER BY updated_at DESC`).all(req.auth.sub);
  res.json({ courses: rows });
});

app.get('/api/trainer/courses/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!courseOwned(req.auth, course)) return res.status(404).json({ error: 'Cours introuvable.' });
  const questionRows = await db.prepare("SELECT q.* FROM course_questions cq JOIN questions q ON q.id=cq.question_id WHERE cq.course_id=? AND q.is_active=1 AND q.status='published' ORDER BY cq.sort_order,q.prompt").all(course.id);
  const questions = await Promise.all(questionRows.map(q => mapQuestion(q)));
  const cohorts = await db.prepare('SELECT c.* FROM course_cohorts cc JOIN cohorts c ON c.id=cc.cohort_id WHERE cc.course_id=?').all(course.id);
  res.json({ course, questions, cohorts });
});

app.post('/api/trainer/courses', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const title = String(req.body?.title || '').trim();if (!title) return res.status(400).json({ error: 'Nom du cours requis.' });
  const requestedStatus = String(req.body?.status || 'draft');
  if (!['draft', 'published', 'archived'].includes(requestedStatus)) return res.status(400).json({ error: 'Statut de cours invalide.' });
  const course = { id: id(), trainer_id: req.auth.sub, title, description: String(req.body?.description || ''), module_code: String(req.body?.moduleCode || ''), level: String(req.body?.level || ''), status: requestedStatus, created_at: now(), updated_at: now() };
  await db.prepare('INSERT INTO courses (id,trainer_id,title,description,module_code,level,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(course.id, course.trainer_id, course.title, course.description, course.module_code, course.level, course.status, course.created_at, course.updated_at);
  res.status(201).json({ course });
});

app.put('/api/trainer/courses/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);if (!courseOwned(req.auth, course)) return res.status(404).json({ error: 'Cours introuvable.' });
  const title = String(req.body?.title ?? course.title).trim();
  if (!title) return res.status(400).json({ error: 'Nom du cours requis.' });
  const requestedStatus = String(req.body?.status ?? course.status);
  if (!['draft', 'published', 'archived'].includes(requestedStatus)) return res.status(400).json({ error: 'Statut de cours invalide.' });
  await db.prepare('UPDATE courses SET title=?,description=?,module_code=?,level=?,status=?,updated_at=? WHERE id=?').run(title, String(req.body?.description ?? course.description), String(req.body?.moduleCode ?? course.module_code ?? ''), String(req.body?.level ?? course.level ?? ''), requestedStatus, now(), course.id);
  res.json({ course: await db.prepare('SELECT * FROM courses WHERE id=?').get(course.id) });
});

app.delete('/api/trainer/courses/:id', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);if (!courseOwned(req.auth, course)) return res.status(404).json({ error: 'Cours introuvable.' });
  await db.prepare('DELETE FROM courses WHERE id=?').run(course.id);res.status(204).end();
});

app.post('/api/trainer/courses/:id/questions', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!courseOwned(req.auth, course)) return res.status(404).json({ error: 'Cours introuvable.' });
  const questionId = String(req.body?.questionId || '');
  const question = await db.prepare("SELECT id,prompt,status,is_active FROM questions WHERE id=?").get(questionId);
  if (!question || !question.is_active) return res.status(404).json({ error: 'Question introuvable.' });
  if (question.status !== 'published') return res.status(409).json({ error: 'Seules les questions publiées peuvent être ajoutées à un cours destiné aux apprenants.', code: 'QUESTION_NOT_PUBLISHED' });
  const existing = await db.prepare('SELECT sort_order FROM course_questions WHERE course_id=? AND question_id=?').get(course.id, questionId);
  if (existing) return res.json({ ok: true, added: false, alreadyPresent: true, sortOrder: existing.sort_order });
  const nextOrder = Number(req.body?.sortOrder || 0) > 0 ? Number(req.body.sortOrder) : Number((await db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM course_questions WHERE course_id=?').get(course.id))?.n || 1);
  await db.prepare('INSERT INTO course_questions (course_id,question_id,sort_order) VALUES (?,?,?)').run(course.id, questionId, nextOrder);
  res.status(201).json({ ok: true, added: true, questionId, sortOrder: nextOrder });
});

app.post('/api/trainer/courses/:id/questions/batch', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!courseOwned(req.auth, course)) return res.status(404).json({ error: 'Cours introuvable.' });
  const questionIds = [...new Set((Array.isArray(req.body?.questionIds) ? req.body.questionIds : []).map(String).filter(Boolean))].slice(0, 200);
  if (!questionIds.length) return res.status(400).json({ error: 'Sélectionnez au moins une question.' });
  const find = db.prepare("SELECT id FROM questions WHERE id=? AND is_active=1 AND status='published'");
  const exists = db.prepare('SELECT 1 FROM course_questions WHERE course_id=? AND question_id=?');
  const insert = db.prepare('INSERT INTO course_questions (course_id,question_id,sort_order) VALUES (?,?,?)');
  let order = Number((await db.prepare('SELECT COALESCE(MAX(sort_order),0) AS n FROM course_questions WHERE course_id=?').get(course.id))?.n || 0);
  let added = 0,duplicates = 0,invalid = 0;
  await db.exec('BEGIN');
  try {
    for (const questionId of questionIds) {
      if (!(await find.get(questionId))) {invalid++;continue;}
      if (await exists.get(course.id, questionId)) {duplicates++;continue;}
      await insert.run(course.id, questionId, ++order);added++;
    }
    await db.exec('COMMIT');
  } catch (error) {try {await db.exec('ROLLBACK');} catch {};throw error;}
  res.json({ ok: true, added, duplicates, invalid });
});

app.delete('/api/trainer/courses/:id/questions/:questionId', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);if (!courseOwned(req.auth, course)) return res.status(404).json({ error: 'Cours introuvable.' });
  await db.prepare('DELETE FROM course_questions WHERE course_id=? AND question_id=?').run(course.id, req.params.questionId);res.status(204).end();
});

app.post('/api/trainer/courses/:id/cohorts', requireAuth, requireRole('trainer', 'admin'), async (req, res) => {
  const course = await db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);if (!courseOwned(req.auth, course)) return res.status(404).json({ error: 'Cours introuvable.' });
  const cohort = await db.prepare('SELECT * FROM cohorts WHERE id=?').get(String(req.body?.cohortId || ''));if (!trainerCanAccessCohort(req.auth, cohort)) return res.status(404).json({ error: 'Groupe introuvable.' });
  await db.prepare('INSERT INTO course_cohorts (course_id,cohort_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(course.id, cohort.id);res.json({ ok: true });
});

// ---------------- ADMIN: MDM / USERS / SETTINGS ----------------
function mdmTable(type) {return { modules: 'mdm_modules', themes: 'mdm_themes', levels: 'mdm_levels', 'question-types': 'mdm_question_types' }[type];}
app.post('/api/admin/mdm/:type', requireAuth, requireRole('admin'), async (req, res) => {
  const table = mdmTable(req.params.type);if (!table) return res.status(404).json({ error: 'Référentiel inconnu.' });
  try {
    if (table === 'mdm_modules') await db.prepare('INSERT INTO mdm_modules (id,code,name,description,active,sort_order) VALUES (?,?,?,?,1,?)').run(id(), String(req.body.code || '').trim(), String(req.body.name || '').trim(), String(req.body.description || ''), Number(req.body.sortOrder || 0));else
    if (table === 'mdm_themes') await db.prepare('INSERT INTO mdm_themes (id,module_code,name,active,sort_order) VALUES (?,?,?,1,?)').run(id(), String(req.body.moduleCode || '').trim(), String(req.body.name || '').trim(), Number(req.body.sortOrder || 0));else
    await db.prepare(`INSERT INTO ${table} (code,name,active,sort_order) VALUES (?,?,1,?)`).run(String(req.body.code || '').trim(), String(req.body.name || '').trim(), Number(req.body.sortOrder || 0));
    res.status(201).json({ ok: true });
  } catch (e) {res.status(400).json({ error: e.message });}
});

app.put('/api/admin/mdm/:type/:key', requireAuth, requireRole('admin'), async (req, res) => {
  const table = mdmTable(req.params.type);if (!table) return res.status(404).json({ error: 'Référentiel inconnu.' });
  if (table === 'mdm_modules') await db.prepare('UPDATE mdm_modules SET name=?,description=?,active=?,sort_order=? WHERE id=? OR code=?').run(String(req.body.name || ''), String(req.body.description || ''), req.body.active === false ? 0 : 1, Number(req.body.sortOrder || 0), req.params.key, req.params.key);else
  if (table === 'mdm_themes') await db.prepare('UPDATE mdm_themes SET module_code=?,name=?,active=?,sort_order=? WHERE id=?').run(String(req.body.moduleCode || ''), String(req.body.name || ''), req.body.active === false ? 0 : 1, Number(req.body.sortOrder || 0), req.params.key);else
  await db.prepare(`UPDATE ${table} SET name=?,active=?,sort_order=? WHERE code=?`).run(String(req.body.name || ''), req.body.active === false ? 0 : 1, Number(req.body.sortOrder || 0), req.params.key);
  res.json({ ok: true });
});

app.delete('/api/admin/mdm/:type/:key', requireAuth, requireRole('admin'), async (req, res) => {
  const table = mdmTable(req.params.type);if (!table) return res.status(404).json({ error: 'Référentiel inconnu.' });
  if (table === 'mdm_modules') await db.prepare('UPDATE mdm_modules SET active=0 WHERE id=? OR code=?').run(req.params.key, req.params.key);else
  if (table === 'mdm_themes') await db.prepare('UPDATE mdm_themes SET active=0 WHERE id=?').run(req.params.key);else
  await db.prepare(`UPDATE ${table} SET active=0 WHERE code=?`).run(req.params.key);
  res.status(204).end();
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), async (_req, res) => {
  try {await purgeExpiredSuspendedUsers();} catch (error) {console.error('User purge before admin list failed:', error);}
  const users = await db.prepare(`SELECT id,name,email,role,premium_plan,premium_until,email_verified_at,status,suspended_at,scheduled_delete_at,created_at
    FROM users ORDER BY CASE WHEN status='suspended' THEN 1 ELSE 0 END, created_at DESC`).all();
  res.json({ users });
});

app.put('/api/admin/users/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  const role = String(req.body?.role || '');
  if (!['learner', 'trainer', 'admin'].includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  const target = await db.prepare('SELECT id,role,status FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (target.status === 'suspended') return res.status(409).json({ error: 'Réactivez d’abord ce compte avant de modifier son rôle.' });
  if (target.id === req.auth.sub && role !== 'admin') return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre rôle administrateur.' });
  if (target.role === 'admin' && role !== 'admin') {
    const admins = Number((await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status='active'").get())?.c || 0);
    if (admins <= 1) return res.status(400).json({ error: 'Impossible de retirer le dernier administrateur actif.' });
  }
  await db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);
  if (role !== target.role) await revokeUserSessions(target.id);
  res.json({ user: await db.prepare('SELECT id,name,email,role,status FROM users WHERE id=?').get(target.id) });
});

app.put('/api/admin/users/:id/suspend', requireAuth, requireRole('admin'), async (req, res) => {
  const target = await db.prepare('SELECT id,name,email,role,status FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (target.id === req.auth.sub) return res.status(400).json({ error: 'Vous ne pouvez pas suspendre votre propre compte.' });
  if (target.role === 'admin') {
    const admins = Number((await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status='active'").get())?.c || 0);
    if (admins <= 1) return res.status(400).json({ error: 'Impossible de suspendre le dernier administrateur actif.' });
  }
  if (target.status === 'suspended') {
    return res.json({ user: await db.prepare('SELECT id,name,email,role,status,suspended_at,scheduled_delete_at FROM users WHERE id=?').get(target.id), alreadySuspended: true });
  }
  const suspendedAt = now();
  const scheduledDeleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("UPDATE users SET status='suspended',suspended_at=?,scheduled_delete_at=? WHERE id=?").
  run(suspendedAt, scheduledDeleteAt, target.id);
  await revokeUserSessions(target.id);
  res.json({
    user: await db.prepare('SELECT id,name,email,role,status,suspended_at,scheduled_delete_at FROM users WHERE id=?').get(target.id),
    message: 'Compte suspendu. Il sera supprimé automatiquement dans 24 heures sauf réactivation.'
  });
});

app.put('/api/admin/users/:id/restore', requireAuth, requireRole('admin'), async (req, res) => {
  const target = await db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  await db.prepare("UPDATE users SET status='active',suspended_at=NULL,scheduled_delete_at=NULL WHERE id=?").run(target.id);
  res.json({ user: await db.prepare('SELECT id,name,email,role,status,suspended_at,scheduled_delete_at FROM users WHERE id=?').get(target.id), message: 'Compte réactivé.' });
});

app.get('/api/admin/settings', requireAuth, requireRole('admin'), async (_req, res) => {
  const settings = Object.fromEntries((await db.prepare('SELECT key,value FROM app_settings').all()).map((r) => [r.key, r.value]));res.json({ settings });
});
app.put('/api/admin/settings', requireAuth, requireRole('admin'), async (req, res) => {
  const incoming = req.body?.settings || {};
  const availableKnowledge = Number((await db.prepare("SELECT COUNT(*) AS c FROM questions WHERE is_active=1 AND status='published' AND is_civic=1 AND question_type='knowledge'").get())?.c || 0);
  const availableScenarios = Number((await db.prepare("SELECT COUNT(*) AS c FROM questions WHERE is_active=1 AND status='published' AND is_civic=1 AND question_type='scenario'").get())?.c || 0);
  const numericRules = {
    exam_knowledge_count: { min: 1, max: Math.min(200, Math.max(1, availableKnowledge)), integer: true, label: 'Questions de connaissance' },
    exam_scenario_count: { min: 0, max: Math.min(200, Math.max(0, availableScenarios)), integer: true, label: 'Mises en situation' },
    exam_duration_minutes: { min: 1, max: 240, integer: true, label: 'Durée' },
    exam_pass_percentage: { min: 1, max: 100, integer: false, label: 'Seuil de réussite' }
  };
  const normalized = {};
  for (const [key, rule] of Object.entries(numericRules)) {
    if (incoming[key] === undefined) continue;
    const value = Number(incoming[key]);
    if (!Number.isFinite(value) || value < rule.min || value > rule.max || rule.integer && !Number.isInteger(value)) {
      return res.status(400).json({ error: `${rule.label} doit être compris entre ${rule.min} et ${rule.max}${rule.integer ? ' (nombre entier)' : ''}.` });
    }
    normalized[key] = String(value);
  }
  if (incoming.platform_name !== undefined) {
    const value = String(incoming.platform_name || '').trim();
    if (!value || value.length > 80) return res.status(400).json({ error: 'Nom de plateforme invalide.' });
    normalized.platform_name = value;
  }
  const currentKnowledge = Number(normalized.exam_knowledge_count ?? (await db.prepare("SELECT value FROM app_settings WHERE key='exam_knowledge_count'").get())?.value ?? 28);
  const currentScenario = Number(normalized.exam_scenario_count ?? (await db.prepare("SELECT value FROM app_settings WHERE key='exam_scenario_count'").get())?.value ?? 12);
  normalized.exam_total_questions = String(currentKnowledge + currentScenario);

  const stmt = db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  await db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(normalized)) await stmt.run(k, v);
    await db.exec('COMMIT');
  } catch (error) {
    try {await db.exec('ROLLBACK');} catch {}
    throw error;
  }
  res.json({ ok: true, settings: Object.fromEntries((await db.prepare('SELECT key,value FROM app_settings').all()).map((r) => [r.key, r.value])) });
});

// ---------------- STATIC FRONTEND ----------------
const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Une erreur interne est survenue.' });
});

export default app;

if (!process.env.VERCEL && process.env.CALAMELLE_NO_LISTEN !== 'true') {
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Calamelle API running on http://127.0.0.1:${config.port}`);
    if (fs.existsSync(frontendDist)) console.log(`Calamelle web app served on http://127.0.0.1:${config.port}`);
    console.log(`Payments mode: ${config.paymentsMode}`);
  });

  server.on('error', error => {
    console.error('API SERVER ERROR:', error);
    if (error?.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use.`);
  });

  process.on('SIGINT', () => server.close(() => process.exit(0)));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
