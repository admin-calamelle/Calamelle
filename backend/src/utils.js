import crypto from 'node:crypto';

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const normalizeEmail = (email = '') => String(email).trim().toLowerCase();
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Stable pseudo-random ordering for answer choices. The same question keeps the
// same answer order across refreshes/resumes, while the correct option is no
// longer biased toward A. IDs are used so grading remains based on answer IDs.
export function stableShuffle(items, seed = '') {
  return [...items]
    .map((item, index) => ({
      item,
      index,
      rank: crypto.createHash('sha256')
        .update(`calamelle-answer-order-v1:${seed}:${item?.id ?? index}`)
        .digest('hex')
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.index - b.index)
    .map(entry => entry.item);
}

export function sanitizeUser(row) {
  if (!row) return null;
  const { password_hash, stripe_customer_id, stripe_subscription_id, ...safe } = row;
  if (['monthly', 'annual', 'naturalisation'].includes(String(safe.premium_plan || ''))) {
    const expiresAt = safe.premium_until ? new Date(safe.premium_until).getTime() : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      safe.premium_plan = null;
      safe.premium_until = null;
    }
  }
  return safe;
}
