import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_WRITE_MS = 5 * 60 * 1000;
function isoNow() { return new Date().toISOString(); }

export async function createSession(user, { userAgent = '', ipAddress = '' } = {}) {
  const sessionId = crypto.randomUUID();
  const createdAt = isoNow();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(createdAt);
  await db.prepare(`INSERT INTO auth_sessions
    (id,user_id,created_at,expires_at,revoked_at,last_seen_at,user_agent,ip_address)
    VALUES (?,?,?,?,NULL,?,?,?)`)
    .run(sessionId, user.id, createdAt, expiresAt, createdAt, String(userAgent || '').slice(0, 500), String(ipAddress || '').slice(0, 100));
  return { id: sessionId, expiresAt };
}

export function signToken(user, sessionId) {
  if (!sessionId) throw new Error('A server session is required before signing a Calamelle token.');
  return jwt.sign({ sub: user.id, role: user.role, email: user.email, sid: sessionId, jti: sessionId }, config.jwtSecret, { expiresIn: '7d' });
}

export async function revokeSession(sessionId) {
  if (!sessionId) return 0;
  const result = await db.prepare('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(isoNow(), sessionId);
  return Number(result.changes || 0);
}
export async function revokeUserSessions(userId) {
  if (!userId) return 0;
  const result = await db.prepare('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ? AND revoked_at IS NULL').run(isoNow(), userId);
  return Number(result.changes || 0);
}

async function currentAuthFromToken(token) {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (!decoded?.sid) return { decoded, user: null, blocked: 'session' };
  const session = await db.prepare(`SELECT id,user_id,created_at,expires_at,revoked_at,last_seen_at
    FROM auth_sessions WHERE id = ? AND user_id = ?`).get(decoded.sid, decoded.sub);
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) return { decoded, user: null, session: session || null, blocked: 'session' };
  const user = await db.prepare(`SELECT id,name,email,role,status,suspended_at,scheduled_delete_at FROM users WHERE id=?`).get(decoded.sub);
  if (!user) return { decoded, user: null, session, blocked: 'missing' };
  if (user.status === 'suspended') return { decoded, user, session, blocked: 'suspended' };
  const lastSeenMs = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
  if (!lastSeenMs || Date.now() - lastSeenMs >= LAST_SEEN_WRITE_MS) await db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(isoNow(), session.id);
  return { decoded, user, session, auth: { ...decoded, sub: user.id, role: user.role, email: user.email, name: user.name, sessionId: session.id } };
}

export async function authOptional(req, _res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try {
      const state = await currentAuthFromToken(header.slice(7));
      req.auth = state.auth || null; req.authUser = state.user || null; req.authSession = state.session || null; req.authBlocked = state.blocked || null;
    } catch {
      req.auth = null; req.authUser = null; req.authSession = null; req.authBlocked = null;
    }
  }
  next();
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
  try {
    const state = await currentAuthFromToken(header.slice(7));
    if (state.blocked === 'session') return res.status(401).json({ error: 'Cette session est terminée. Connectez-vous de nouveau.', code: 'SESSION_REVOKED' });
    if (state.blocked === 'missing') return res.status(401).json({ error: 'Compte introuvable.', code: 'ACCOUNT_MISSING' });
    if (state.blocked === 'suspended') return res.status(423).json({ error: 'Ce compte est suspendu. Contactez un administrateur si vous pensez qu’il s’agit d’une erreur.', code: 'ACCOUNT_SUSPENDED', scheduledDeleteAt: state.user?.scheduled_delete_at || null });
    req.auth = state.auth; req.authUser = state.user; req.authSession = state.session; next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session.', code: 'SESSION_INVALID' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Insufficient permissions.' });
    next();
  };
}
