import crypto from 'node:crypto';
import { config } from './config.js';

const STRIPE_API = 'https://api.stripe.com/v1';

export const stripePlans = {
  monthly: {
    label: 'Illimité mensuel',
    amountCents: 499,
    mode: 'subscription',
    priceId: () => config.stripePriceMonthly,
    fallbackDays: 31
  },
  annual: {
    label: 'Illimité annuel',
    amountCents: 3499,
    mode: 'subscription',
    priceId: () => config.stripePriceAnnual,
    fallbackDays: 365
  },
  naturalisation: {
    label: 'Pass Naturalisation',
    amountCents: 2499,
    mode: 'payment',
    priceId: () => config.stripePriceNaturalisation,
    fallbackDays: 183
  },
  lifetime: {
    label: 'Fondateur à vie',
    amountCents: 5900,
    mode: 'payment',
    priceId: () => config.stripePriceLifetime,
    fallbackDays: null
  }
};

export function stripeConfigured() {
  return Boolean(config.stripeSecretKey);
}

function assertStripeConfigured() {
  if (!config.stripeSecretKey) {
    const error = new Error('Stripe n’est pas encore configuré. Ajoutez STRIPE_SECRET_KEY dans backend/.env.');
    error.code = 'STRIPE_NOT_CONFIGURED';
    throw error;
  }
}

function appendParam(params, key, value) {
  if (value === undefined || value === null || value === '') return;
  params.append(key, String(value));
}

async function stripeRequest(method, path, payload = null) {
  assertStripeConfigured();
  const headers = {
    Authorization: `Bearer ${config.stripeSecretKey}`
  };

  let body;
  if (payload) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) appendParam(params, key, value);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = params.toString();
  }

  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Stripe HTTP ${response.status}`);
    error.code = data?.error?.code || 'STRIPE_API_ERROR';
    error.status = response.status;
    error.stripe = data?.error || null;
    throw error;
  }
  return data;
}

export async function createStripeCustomer({ email, name, userId }) {
  return stripeRequest('POST', '/customers', {
    email,
    name,
    'metadata[user_id]': userId
  });
}

export async function createCheckoutSession({ planKey, user, customerId }) {
  const plan = stripePlans[planKey];
  if (!plan) throw new Error('Offre Stripe inconnue.');
  const priceId = plan.priceId();
  if (!priceId) {
    const error = new Error(`Le Price ID Stripe de l’offre « ${plan.label} » n’est pas configuré.`);
    error.code = 'STRIPE_PRICE_NOT_CONFIGURED';
    throw error;
  }

  const successUrl = `${config.frontendUrl}/app/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.frontendUrl}/app/pricing?checkout=cancelled`;
  const payload = {
    mode: plan.mode,
    customer: customerId,
    client_reference_id: user.id,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: 'true',
    'metadata[user_id]': user.id,
    'metadata[plan]': planKey
  };

  if (plan.mode === 'subscription') {
    payload['subscription_data[metadata][user_id]'] = user.id;
    payload['subscription_data[metadata][plan]'] = planKey;
  } else {
    payload['payment_intent_data[metadata][user_id]'] = user.id;
    payload['payment_intent_data[metadata][plan]'] = planKey;
  }

  return stripeRequest('POST', '/checkout/sessions', payload);
}

export async function createBillingPortalSession({ customerId }) {
  return stripeRequest('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: `${config.frontendUrl}/app/pricing`
  });
}

export async function retrieveCheckoutSession(sessionId) {
  return stripeRequest('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`);
}

export async function retrieveSubscription(subscriptionId) {
  return stripeRequest('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export function verifyStripeWebhookSignature(rawBody, signatureHeader) {
  if (!config.stripeWebhookSecret) {
    const error = new Error('STRIPE_WEBHOOK_SECRET n’est pas configuré.');
    error.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED';
    throw error;
  }

  const parts = String(signatureHeader || '').split(',').map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith('t='))?.slice(2);
  const signatures = parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  if (!timestamp || !signatures.length) throw new Error('Signature Stripe invalide.');

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) throw new Error('Signature Stripe expirée.');

  const payload = `${timestamp}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)}`;
  const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(payload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  const valid = signatures.some(value => {
    try {
      const candidate = Buffer.from(value, 'hex');
      return candidate.length === expectedBuffer.length && crypto.timingSafeEqual(candidate, expectedBuffer);
    } catch {
      return false;
    }
  });

  if (!valid) throw new Error('La signature Stripe ne correspond pas.');
  return true;
}
