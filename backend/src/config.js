import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load backend/.env first, then project-root .env. Existing environment variables win.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), override: false });

const nodeEnv = process.env.NODE_ENV || 'development';
const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';
const hasSmtp = Boolean(smtpUser && smtpPass);

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'calamelle-development-secret-change-me',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  paymentsMode: process.env.PAYMENTS_MODE || 'demo',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY || '',
  stripePriceAnnual: process.env.STRIPE_PRICE_ANNUAL || '',
  stripePriceNaturalisation: process.env.STRIPE_PRICE_NATURALISATION || '',
  stripePriceLifetime: process.env.STRIPE_PRICE_LIFETIME || '',

  nodeEnv,

  // Brevo SMTP
  smtpHost: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser,
  smtpPass,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpStartTls: process.env.SMTP_STARTTLS ? process.env.SMTP_STARTTLS === 'true' : true,
  smtpTimeoutMs: Math.max(5_000, Number(process.env.SMTP_TIMEOUT_MS || 20_000)),
  smtpDnsFallback: process.env.SMTP_DNS_FALLBACK ? process.env.SMTP_DNS_FALLBACK === 'true' : true,
  smtpDnsServers: String(process.env.SMTP_DNS_SERVERS || '1.1.1.1,8.8.8.8')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  emailFrom: process.env.EMAIL_FROM || 'Calamelle <gftijnational@gmail.com>',

  otpExpiryMinutes: Math.max(3, Number(process.env.OTP_EXPIRY_MINUTES || 10)),
  otpResendSeconds: Math.max(30, Number(process.env.OTP_RESEND_SECONDS || 60)),
  otpMaxAttempts: Math.max(3, Number(process.env.OTP_MAX_ATTEMPTS || 5)),
  otpMaxResends: Math.max(2, Number(process.env.OTP_MAX_RESENDS || 5)),
  passwordResetMinutes: Math.max(10, Number(process.env.PASSWORD_RESET_MINUTES || 30)),
  exposeDevOtp: process.env.EXPOSE_DEV_OTP
    ? process.env.EXPOSE_DEV_OTP === 'true'
    : nodeEnv !== 'production' && !hasSmtp,
  demoAccessCodeEnabled: process.env.ENABLE_DEMO_ACCESS_CODE
    ? process.env.ENABLE_DEMO_ACCESS_CODE === 'true'
    : nodeEnv !== 'production'
};

export function assertProductionConfig() {
  if (nodeEnv !== 'production') return;
  if (!process.env.JWT_SECRET || config.jwtSecret === 'calamelle-development-secret-change-me' || config.jwtSecret.length < 32) {
    throw new Error('Production requires a strong JWT_SECRET (32+ characters).');
  }
  if (!process.env.PAYMENTS_MODE) {
    throw new Error('Production requires PAYMENTS_MODE to be explicitly configured.');
  }
  if (config.paymentsMode === 'demo') {
    throw new Error('PAYMENTS_MODE=demo is disabled in production. Use stripe.');
  }
  if (config.paymentsMode === 'stripe' && !config.stripeSecretKey) {
    throw new Error('Production Stripe mode requires STRIPE_SECRET_KEY.');
  }
}
