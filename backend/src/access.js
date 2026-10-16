import { db } from './db.js';
import { now, shuffle } from './utils.js';

export const FREE_DAILY_NEW_LIMIT = 20;
export const FREE_CIVIC_MOCK_LIMIT = 1;

const FULL_PLANS = new Set(['monthly', 'annual', 'lifetime']);
const PAID_PLANS = new Set(['monthly', 'annual', 'naturalisation', 'lifetime']);

export class AccessError extends Error {
  constructor(message, code = 'ACCESS_DENIED', status = 403, access = null) {
    super(message);
    this.name = 'AccessError';
    this.code = code;
    this.status = status;
    this.access = access;
  }
}

export function franceDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getActivePlan(user) {
  if (!user) return null;
  if (user.role === 'admin' || user.role === 'trainer') return user.role;
  const plan = String(user.premium_plan || '');
  if (!PAID_PLANS.has(plan)) return null;
  if (plan === 'lifetime') return 'lifetime';
  if (!user.premium_until) return null;
  const expiresAt = new Date(user.premium_until).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now() ? plan : null;
}

export function hasFullAccess(user) {
  const plan = getActivePlan(user);
  return user?.role === 'admin' || user?.role === 'trainer' || FULL_PLANS.has(plan);
}
export function hasNaturalisationAccess(user) { return hasFullAccess(user) || getActivePlan(user) === 'naturalisation'; }
export function hasUnlimitedQuestionAccess(user, question) {
  if (hasFullAccess(user)) return true;
  return getActivePlan(user) === 'naturalisation' && Boolean(question?.is_civic);
}

export async function dailyFreeQuestionStats(userId) {
  if (!userId) return { attempted: 0, correct: 0, incorrect: 0, accuracy: 0 };
  const row = await db.prepare(`SELECT
      COUNT(*) AS attempted,
      COALESCE(SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END),0) AS correct_count,
      COALESCE(SUM(CASE WHEN correct=0 THEN 1 ELSE 0 END),0) AS incorrect_count
    FROM daily_free_questions
    WHERE user_id=? AND access_date=? AND answered_at IS NOT NULL`)
    .get(userId, franceDayKey());
  const attempted = Number(row?.attempted || 0);
  const correct = Number(row?.correct_count || 0);
  const incorrect = Number(row?.incorrect_count || 0);
  return { attempted, correct, incorrect, accuracy: attempted ? Math.round((correct / attempted) * 100) : 0 };
}

export async function dailyNewQuestionUsage(userId) { return (await dailyFreeQuestionStats(userId)).attempted; }

export async function freeCivicMockUsage(userId) {
  if (!userId) return 0;
  const attempts = Number((await db.prepare("SELECT COUNT(*) AS c FROM exam_attempts WHERE user_id=? AND (access_plan='free' OR access_plan IS NULL OR TRIM(access_plan)='')")
    .get(userId))?.c || 0);
  const sessions = Number((await db.prepare("SELECT COUNT(*) AS c FROM exam_sessions WHERE user_id=? AND access_plan='free'")
    .get(userId))?.c || 0);
  return Math.max(attempts, sessions);
}

export async function getAccessSummary(userOrId) {
  const user = typeof userOrId === 'string'
    ? await db.prepare('SELECT * FROM users WHERE id=?').get(userOrId)
    : userOrId;
  if (!user) return null;

  const activePlan = getActivePlan(user);
  const fullAccess = hasFullAccess(user);
  const naturalisationAccess = getActivePlan(user) === 'naturalisation';
  const dailyStats = fullAccess ? null : await dailyFreeQuestionStats(user.id);
  const usedNew = fullAccess ? 0 : dailyStats.attempted;
  const remainingNew = fullAccess ? null : Math.max(0, FREE_DAILY_NEW_LIMIT - usedNew);
  const usedMocks = (fullAccess || naturalisationAccess) ? 0 : await freeCivicMockUsage(user.id);
  const remainingMocks = (fullAccess || naturalisationAccess) ? null : Math.max(0, FREE_CIVIC_MOCK_LIMIT - usedMocks);

  return {
    plan: activePlan || 'free',
    premiumUntil: activePlan && activePlan !== 'lifetime' ? user.premium_until || null : null,
    fullAccess,
    naturalisationAccess,
    dailyNewQuestions: {
      unlimited: fullAccess,
      limit: fullAccess ? null : FREE_DAILY_NEW_LIMIT,
      used: fullAccess ? null : usedNew,
      remaining: remainingNew,
      correct: fullAccess ? null : dailyStats.correct,
      incorrect: fullAccess ? null : dailyStats.incorrect,
      accuracy: fullAccess ? null : dailyStats.accuracy
    },
    civicMock: {
      unlimited: fullAccess || naturalisationAccess,
      limit: (fullAccess || naturalisationAccess) ? null : FREE_CIVIC_MOCK_LIMIT,
      used: (fullAccess || naturalisationAccess) ? null : usedMocks,
      remaining: remainingMocks
    },
    features: {
      learning: true, reviews: true, civicExam: true,
      journey: fullAccess || naturalisationAccess,
      speed: fullAccess || naturalisationAccess,
      compendium: fullAccess || naturalisationAccess,
      progress: true, courses: true
    }
  };
}

export async function questionAlreadyUnlocked(userId, questionId) {
  if (!userId || !questionId) return false;
  if (await db.prepare('SELECT 1 FROM progress WHERE user_id=? AND question_id=?').get(userId, questionId)) return true;
  return Boolean(await db.prepare(`SELECT 1 FROM daily_free_questions
    WHERE user_id=? AND question_id=? AND answered_at IS NOT NULL LIMIT 1`).get(userId, questionId));
}

export async function ensureQuestionAccess(userId, question) {
  if (!userId || !question) return { kind: 'guest' };
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw new AccessError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
  if (hasUnlimitedQuestionAccess(user, question)) return { kind: 'unlimited' };
  if (await questionAlreadyUnlocked(userId, question.id)) return { kind: 'review' };

  const access = await getAccessSummary(user);
  if ((access?.dailyNewQuestions?.remaining ?? 0) <= 0) {
    throw new AccessError('Vous avez terminé vos 20 questions gratuites pour aujourd’hui. Revenez demain ou choisissez une offre illimitée.', 'FREE_DAILY_LIMIT', 402, access);
  }
  return { kind: 'new', access };
}

export async function recordDailyQuestionAttempt(userId, question, answerId, correct, source = 'learning') {
  if (!userId || !question) return null;
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw new AccessError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
  if (hasUnlimitedQuestionAccess(user, question)) return getAccessSummary(user);
  if (await questionAlreadyUnlocked(userId, question.id)) return getAccessSummary(user);

  const accessBefore = await getAccessSummary(user);
  if ((accessBefore?.dailyNewQuestions?.remaining ?? 0) <= 0) {
    throw new AccessError('Vous avez terminé vos 20 questions gratuites pour aujourd’hui. Revenez demain ou choisissez une offre illimitée.', 'FREE_DAILY_LIMIT', 402, accessBefore);
  }

  const day = franceDayKey();
  const ts = now();
  await db.prepare(`INSERT INTO daily_free_questions
      (user_id,access_date,question_id,source,reserved_at,answered_at,answer_id,correct)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,access_date,question_id) DO UPDATE SET
      answered_at=COALESCE(daily_free_questions.answered_at,excluded.answered_at),
      answer_id=CASE WHEN daily_free_questions.answered_at IS NULL THEN excluded.answer_id ELSE daily_free_questions.answer_id END,
      correct=CASE WHEN daily_free_questions.answered_at IS NULL THEN excluded.correct ELSE daily_free_questions.correct END`)
    .run(userId, day, question.id, source || 'learning', ts, ts, answerId || null, correct ? 1 : 0);

  return getAccessSummary(user);
}

export async function reserveNextDailyFreeQuestion(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw new AccessError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
  if (hasFullAccess(user)) return { question: null, complete: false, unlimited: true, access: await getAccessSummary(user) };

  const day = franceDayKey();
  let access = await getAccessSummary(user);
  if ((access?.dailyNewQuestions?.remaining ?? 0) <= 0) return { question: null, complete: true, access };

  const pending = await db.prepare(`SELECT q.* FROM daily_free_questions d
    JOIN questions q ON q.id=d.question_id
    WHERE d.user_id=? AND d.access_date=? AND d.source='dashboard'
      AND d.answered_at IS NULL AND q.is_active=1 AND q.status='published' AND q.is_civic=0
    ORDER BY d.reserved_at ASC LIMIT 1`).get(userId, day);
  if (pending) return { question: pending, complete: false, access, currentNumber: Number(access.dailyNewQuestions.used || 0) + 1 };

  const categories = (await db.prepare(`SELECT DISTINCT category FROM questions
    WHERE is_active=1 AND status='published' AND is_civic=0 ORDER BY category`).all()).map(row => row.category);
  if (!categories.length) return { question: null, complete: true, access };

  const counts = new Map(categories.map(category => [category, 0]));
  const countRows = await db.prepare(`SELECT q.category,COUNT(*) AS c FROM daily_free_questions d
    JOIN questions q ON q.id=d.question_id
    WHERE d.user_id=? AND d.access_date=? AND d.answered_at IS NOT NULL AND q.is_civic=0
    GROUP BY q.category`).all(userId, day);
  countRows.forEach(row => counts.set(row.category, Number(row.c || 0)));

  const minCount = Math.min(...counts.values());
  const preferredCategories = shuffle(categories.filter(category => counts.get(category) === minCount));
  const pickInCategory = db.prepare(`SELECT q.* FROM questions q
    WHERE q.is_active=1 AND q.status='published' AND q.is_civic=0 AND q.category=?
      AND NOT EXISTS(SELECT 1 FROM progress p WHERE p.user_id=? AND p.question_id=q.id)
      AND NOT EXISTS(SELECT 1 FROM daily_free_questions d WHERE d.user_id=? AND d.question_id=q.id AND d.answered_at IS NOT NULL)
    ORDER BY RANDOM() LIMIT 1`);

  let question = null;
  for (const category of preferredCategories) {
    question = await pickInCategory.get(category, userId, userId);
    if (question) break;
  }
  if (!question) {
    question = await db.prepare(`SELECT q.* FROM questions q
      WHERE q.is_active=1 AND q.status='published' AND q.is_civic=0
        AND NOT EXISTS(SELECT 1 FROM daily_free_questions d WHERE d.user_id=? AND d.access_date=? AND d.question_id=q.id)
      ORDER BY RANDOM() LIMIT 1`).get(userId, day);
  }
  if (!question) return { question: null, complete: true, access };

  await db.prepare(`INSERT INTO daily_free_questions
    (user_id,access_date,question_id,source,reserved_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id,access_date,question_id) DO NOTHING`).run(userId, day, question.id, 'dashboard', now());

  access = await getAccessSummary(user);
  return { question, complete: false, access, currentNumber: Number(access.dailyNewQuestions.used || 0) + 1 };
}

export async function assertCivicMockAvailable(userId) {
  const user = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user) throw new AccessError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
  const access = await getAccessSummary(user);
  if (access.civicMock.unlimited) return access;
  if ((access.civicMock.remaining ?? 0) <= 0) {
    throw new AccessError('Votre examen blanc gratuit a déjà été utilisé. Choisissez une offre pour accéder aux examens blancs illimités.', 'FREE_MOCK_USED', 402, access);
  }
  return access;
}

export async function assertFeature(userId, feature) {
  const access = await getAccessSummary(userId);
  if (!access) throw new AccessError('Utilisateur introuvable.', 'USER_NOT_FOUND', 404);
  if (access.features?.[feature]) return access;
  const names = { journey: 'le parcours guidé', speed: 'le défi 60 secondes', compendium: 'le Compendium' };
  throw new AccessError(`${names[feature] || 'Cette fonctionnalité'} est réservé(e) aux offres payantes.`, 'PREMIUM_FEATURE_REQUIRED', 402, access);
}

export function accessErrorResponse(res, error) {
  if (!(error instanceof AccessError)) return false;
  res.status(error.status || 403).json({ error: error.message, code: error.code, ...(error.access ? { access: error.access } : {}) });
  return true;
}
