import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { id, now, stableShuffle } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'calamelle.db');
const questionBankPath = path.join(__dirname, '..', 'data', 'Calamelle_QCM_2741_FLAT.json');
const QUESTION_BANK_VERSION = 'calamelle-qcm-2741-v1';

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA synchronous = NORMAL;');

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'learner',
      premium_plan TEXT,
      premium_until TEXT,
      email_verified_at TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      suspended_at TEXT,
      scheduled_delete_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_seen_at TEXT,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_registrations (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      password_hash TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      otp_expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      resend_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      explanation TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'Apprenti',
      civic_theme TEXT,
      question_type TEXT NOT NULL DEFAULT 'knowledge',
      is_civic INTEGER NOT NULL DEFAULT 0,
      source_module TEXT,
      source_theme TEXT,
      naturalisation INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'published',
      author_id TEXT,
      validated_by TEXT,
      validated_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      box INTEGER NOT NULL DEFAULT 1,
      correct_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at TEXT,
      next_review_at TEXT,
      PRIMARY KEY (user_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS exam_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      percentage REAL NOT NULL,
      passed INTEGER NOT NULL,
      breakdown_json TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      access_plan TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_ids_json TEXT NOT NULL,
      access_plan TEXT NOT NULL DEFAULT 'free',
      duration_seconds INTEGER NOT NULL DEFAULT 2700,
      pass_percentage REAL NOT NULL DEFAULT 80,
      expires_at TEXT NOT NULL,
      submitted_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_unlocks (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      access_date TEXT NOT NULL,
      first_accessed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS daily_free_questions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_date TEXT NOT NULL,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'dashboard',
      reserved_at TEXT NOT NULL,
      answered_at TEXT,
      answer_id TEXT REFERENCES answers(id) ON DELETE SET NULL,
      correct INTEGER,
      PRIMARY KEY (user_id, access_date, question_id)
    );

    CREATE TABLE IF NOT EXISTS institutions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cohorts (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      trainer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      start_date TEXT,
      end_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cohort_members (
      cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (cohort_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      trainer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      module_code TEXT,
      level TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS course_questions (
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (course_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS course_cohorts (
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
      PRIMARY KEY (course_id, cohort_id)
    );

    CREATE TABLE IF NOT EXISTS course_question_attempts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      answer_id TEXT,
      correct INTEGER NOT NULL DEFAULT 0,
      answered_at TEXT NOT NULL,
      PRIMARY KEY (user_id, course_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS course_completions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS mdm_modules (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mdm_themes (
      id TEXT PRIMARY KEY,
      module_code TEXT NOT NULL,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(module_code, name)
    );

    CREATE TABLE IF NOT EXISTS mdm_levels (
      code TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mdm_question_types (
      code TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL,
      expires_at TEXT,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      stripe_session_id TEXT,
      stripe_payment_intent_id TEXT,
      stripe_subscription_id TEXT,
      updated_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stripe_events (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_change_requests (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      new_email TEXT UNIQUE NOT NULL,
      otp_hash TEXT NOT NULL,
      otp_expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      resend_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  migrateColumns();
  ensureQuestionBank();
  if (process.env.NODE_ENV !== 'production') seedUsersAndCodesIfEmpty();
  seedMdm();
  seedSettings();
  if (process.env.NODE_ENV !== 'production') seedDemoCourse();
}

function migrateColumns() {
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map(row => row.name);
  if (!userColumns.includes('email_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT;');
    db.exec('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;');
  }
  if (!userColumns.includes('stripe_customer_id')) db.exec('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;');
  if (!userColumns.includes('stripe_subscription_id')) db.exec('ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;');
  if (!userColumns.includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
  if (!userColumns.includes('suspended_at')) db.exec('ALTER TABLE users ADD COLUMN suspended_at TEXT;');
  if (!userColumns.includes('scheduled_delete_at')) db.exec('ALTER TABLE users ADD COLUMN scheduled_delete_at TEXT;');
  if (!userColumns.includes('first_name')) db.exec('ALTER TABLE users ADD COLUMN first_name TEXT;');
  if (!userColumns.includes('last_name')) db.exec('ALTER TABLE users ADD COLUMN last_name TEXT;');

  const pendingColumns = db.prepare('PRAGMA table_info(pending_registrations)').all().map(row => row.name);
  if (!pendingColumns.includes('first_name')) db.exec('ALTER TABLE pending_registrations ADD COLUMN first_name TEXT;');
  if (!pendingColumns.includes('last_name')) db.exec('ALTER TABLE pending_registrations ADD COLUMN last_name TEXT;');

  const usersWithoutStructuredName = db.prepare(`SELECT id,name FROM users
    WHERE first_name IS NULL OR TRIM(first_name)='' OR last_name IS NULL OR TRIM(last_name)=''`).all();
  const updateStructuredName = db.prepare('UPDATE users SET first_name=?,last_name=? WHERE id=?');
  usersWithoutStructuredName.forEach(row => {
    const parts = String(row.name || '').trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || String(row.name || '').trim() || 'Utilisateur';
    const lastName = parts.join(' ') || '-';
    updateStructuredName.run(firstName, lastName, row.id);
  });
  db.exec("UPDATE users SET status='active' WHERE status IS NULL OR TRIM(status)='';");
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_status_delete ON users(status, scheduled_delete_at);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, revoked_at, expires_at);');

  const paymentColumns = db.prepare('PRAGMA table_info(payments)').all().map(row => row.name);
  if (!paymentColumns.includes('stripe_session_id')) db.exec('ALTER TABLE payments ADD COLUMN stripe_session_id TEXT;');
  if (!paymentColumns.includes('stripe_payment_intent_id')) db.exec('ALTER TABLE payments ADD COLUMN stripe_payment_intent_id TEXT;');
  if (!paymentColumns.includes('stripe_subscription_id')) db.exec('ALTER TABLE payments ADD COLUMN stripe_subscription_id TEXT;');
  if (!paymentColumns.includes('updated_at')) db.exec('ALTER TABLE payments ADD COLUMN updated_at TEXT;');
  db.exec('CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_change_new_email ON email_change_requests(new_email);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_session_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_question_unlocks_day ON question_unlocks(user_id, access_date);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_daily_free_questions_day ON daily_free_questions(user_id, access_date, answered_at);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_exam_sessions_user ON exam_sessions(user_id, created_at);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_exam_sessions_expiry ON exam_sessions(expires_at, submitted_at);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_course_attempts_user_course ON course_question_attempts(user_id, course_id);');

  const examColumns = db.prepare('PRAGMA table_info(exam_attempts)').all().map(row => row.name);
  if (!examColumns.includes('access_plan')) db.exec('ALTER TABLE exam_attempts ADD COLUMN access_plan TEXT;');

  const examSessionColumns = db.prepare('PRAGMA table_info(exam_sessions)').all().map(row => row.name);
  if (!examSessionColumns.includes('duration_seconds')) db.exec('ALTER TABLE exam_sessions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 2700;');
  if (!examSessionColumns.includes('pass_percentage')) db.exec('ALTER TABLE exam_sessions ADD COLUMN pass_percentage REAL NOT NULL DEFAULT 80;');

  const questionColumns = db.prepare('PRAGMA table_info(questions)').all().map(row => row.name);
  if (!questionColumns.includes('source_module')) db.exec('ALTER TABLE questions ADD COLUMN source_module TEXT;');
  if (!questionColumns.includes('source_theme')) db.exec('ALTER TABLE questions ADD COLUMN source_theme TEXT;');
  if (!questionColumns.includes('naturalisation')) db.exec('ALTER TABLE questions ADD COLUMN naturalisation INTEGER NOT NULL DEFAULT 0;');
  if (!questionColumns.includes('status')) db.exec("ALTER TABLE questions ADD COLUMN status TEXT NOT NULL DEFAULT 'published';");
  if (!questionColumns.includes('author_id')) db.exec('ALTER TABLE questions ADD COLUMN author_id TEXT;');
  if (!questionColumns.includes('validated_by')) db.exec('ALTER TABLE questions ADD COLUMN validated_by TEXT;');
  if (!questionColumns.includes('validated_at')) db.exec('ALTER TABLE questions ADD COLUMN validated_at TEXT;');

  const cohortColumns = db.prepare('PRAGMA table_info(cohorts)').all().map(row => row.name);
  if (!cohortColumns.includes('description')) db.exec('ALTER TABLE cohorts ADD COLUMN description TEXT;');
  if (!cohortColumns.includes('start_date')) db.exec('ALTER TABLE cohorts ADD COLUMN start_date TEXT;');
  if (!cohortColumns.includes('end_date')) db.exec('ALTER TABLE cohorts ADD COLUMN end_date TEXT;');
}

function seedUsersAndCodesIfEmpty() {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (users === 0) seedUsersAndTrainerData();
  const codes = db.prepare('SELECT COUNT(*) AS c FROM access_codes').get().c;
  if (codes === 0) seedCodes();
}

function readQuestionBank() {
  if (!fs.existsSync(questionBankPath)) throw new Error(`Question bank not found: ${questionBankPath}`);
  const parsed = JSON.parse(fs.readFileSync(questionBankPath, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('The Calamelle question bank is empty or invalid.');
  return parsed;
}

const difficultyMap = { facile: 'Apprenti', moyen: 'Lettré', difficile: 'Érudit' };

export function normalizeSourceQuestion(q) {
  if (q?.question && Array.isArray(q?.propositions)) {
    const correctIndex = q.propositions.findIndex(answer => Boolean(answer?.correcte));
    if (correctIndex < 0) throw new Error(`Aucune bonne réponse définie pour ${q.id || q.question}`);
    const sourceModule = String(q.module || '').trim();
    const isCivic = sourceModule === 'Examen civique';
    const type = String(q.type || '').toLowerCase();
    return {
      id: q.id ? String(q.id) : undefined,
      prompt: String(q.question).trim(),
      explanation: String(q.explication || '').trim(),
      category: isCivic ? 'Citoyenneté' : sourceModule,
      difficulty: difficultyMap[String(q.niveau || '').toLowerCase()] || 'Apprenti',
      civicTheme: isCivic ? String(q.theme || '').trim() || null : null,
      questionType: type.includes('mise en situation') ? 'scenario' : 'knowledge',
      isCivic,
      sourceModule: sourceModule || null,
      sourceTheme: q.theme ? String(q.theme).trim() : null,
      naturalisation: Boolean(q.naturalisation),
      status: String(q.status || 'published'),
      authorId: q.authorId ? String(q.authorId) : null,
      answers: q.propositions.map(answer => String(answer?.texte ?? '').trim()),
      correctIndex
    };
  }

  if (q?.prompt && Array.isArray(q?.answers)) {
    return {
      id: q.id ? String(q.id) : undefined,
      prompt: String(q.prompt).trim(),
      explanation: String(q.explanation || '').trim(),
      category: String(q.category || '').trim(),
      difficulty: String(q.difficulty || 'Apprenti'),
      civicTheme: q.civicTheme ? String(q.civicTheme) : null,
      questionType: String(q.questionType || 'knowledge'),
      isCivic: Boolean(q.isCivic),
      sourceModule: q.sourceModule ? String(q.sourceModule) : null,
      sourceTheme: q.sourceTheme ? String(q.sourceTheme) : null,
      naturalisation: Boolean(q.naturalisation),
      status: String(q.status || 'published'),
      authorId: q.authorId ? String(q.authorId) : null,
      answers: q.answers.map(answer => typeof answer === 'string' ? answer.trim() : String(answer?.text || '').trim()),
      correctIndex: Number.isFinite(Number(q.correctIndex)) ? Number(q.correctIndex) : Math.max(0, q.answers.findIndex(a => Boolean(a?.isCorrect)))
    };
  }
  throw new Error('Format de question non reconnu.');
}

function ensureQuestionBank() {
  const existingVersion = db.prepare("SELECT value FROM content_meta WHERE key = 'question_bank_version'").get()?.value;
  if (existingVersion === QUESTION_BANK_VERSION) return;
  const bank = readQuestionBank();
  console.log(`Installing Calamelle question bank (${bank.length} QCM)...`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM exam_attempts;');
    db.exec('DELETE FROM questions;');
    for (const raw of bank) insertQuestion(normalizeSourceQuestion(raw));
    db.prepare(`INSERT INTO content_meta (key,value) VALUES ('question_bank_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(QUESTION_BANK_VERSION);
    db.prepare(`INSERT INTO content_meta (key,value) VALUES ('question_bank_count',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(bank.length));
    db.exec('COMMIT');
    console.log(`Installed ${bank.length} Calamelle QCM.`);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function insertQuestion(q) {
  const normalized = normalizeSourceQuestion(q);
  const qid = normalized.id || id();
  const ts = now();
  const isDraft = normalized.status === 'draft';
  if (!normalized.prompt || !normalized.category) throw new Error('Question et module sont requis.');
  if (!isDraft && !normalized.explanation) throw new Error('Une explication est requise avant validation ou publication.');
  if (!Array.isArray(normalized.answers) || normalized.answers.length < 2) throw new Error('Au moins deux réponses sont requises.');
  if (!isDraft && normalized.answers.some(answer => !answer)) throw new Error('Toutes les réponses doivent être complétées avant validation ou publication.');
  if (normalized.correctIndex < 0 || normalized.correctIndex >= normalized.answers.length) throw new Error('Indice de bonne réponse invalide.');

  db.prepare(`INSERT INTO questions
    (id,prompt,explanation,category,difficulty,civic_theme,question_type,is_civic,source_module,source_theme,naturalisation,status,author_id,is_active,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      qid, normalized.prompt, normalized.explanation, normalized.category,
      normalized.difficulty || 'Apprenti', normalized.civicTheme || null,
      normalized.questionType || 'knowledge', normalized.isCivic ? 1 : 0,
      normalized.sourceModule || normalized.category || null, normalized.sourceTheme || null,
      normalized.naturalisation ? 1 : 0, normalized.status || 'published', normalized.authorId || null,
      1, ts, ts
    );
  const answerStmt = db.prepare('INSERT INTO answers (id,question_id,text,is_correct) VALUES (?,?,?,?)');
  normalized.answers.forEach((answer, idx) => answerStmt.run(id(), qid, answer, idx === normalized.correctIndex ? 1 : 0));
  return qid;
}

function seedUsersAndTrainerData() {
  const ts = now();
  const password = bcrypt.hashSync('Learner123!', 10);
  const trainerPassword = bcrypt.hashSync('Trainer123!', 10);
  const adminPassword = bcrypt.hashSync('Admin123!', 10);
  const learnerId = id(); const learner2Id = id(); const trainerId = id(); const adminId = id();
  const insert = db.prepare('INSERT INTO users (id,name,first_name,last_name,email,password_hash,role,premium_plan,premium_until,email_verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insert.run(learnerId, 'Amina Démo', 'Amina', 'Démo', 'learner@calamelle.local', password, 'learner', null, null, ts, ts);
  insert.run(learner2Id, 'Claire Démo', 'Claire', 'Démo', 'learner2@calamelle.local', password, 'learner', 'annual', '2099-12-31T23:59:59.000Z', ts, ts);
  insert.run(trainerId, 'Josué Formateur', 'Josué', 'Formateur', 'trainer@calamelle.local', trainerPassword, 'trainer', null, null, ts, ts);
  insert.run(adminId, 'Administrateur Calamelle', 'Administrateur', 'Calamelle', 'admin@calamelle.local', adminPassword, 'admin', 'lifetime', null, ts, ts);
  const institutionId = id();
  db.prepare('INSERT INTO institutions (id,name,created_at) VALUES (?,?,?)').run(institutionId, 'Association Démo Calamelle', ts);
  const cohortId = id();
  db.prepare('INSERT INTO cohorts (id,institution_id,trainer_id,name,created_at) VALUES (?,?,?,?,?)').run(cohortId, institutionId, trainerId, 'Groupe A — Démonstration', ts);
  db.prepare('INSERT INTO cohort_members (cohort_id,user_id) VALUES (?,?)').run(cohortId, learnerId);
  db.prepare('INSERT INTO cohort_members (cohort_id,user_id) VALUES (?,?)').run(cohortId, learner2Id);
  console.log('Seeded demo accounts and trainer cohort.');
}

function seedCodes() {
  db.prepare('INSERT INTO access_codes (id,code,plan,expires_at,max_uses,uses,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id(), 'CALA-DEMO-2026', 'annual', '2099-12-31T23:59:59.000Z', 50, 0, now());
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || id().slice(0, 8);
}

function seedMdm() {
  const modules = db.prepare("SELECT DISTINCT category FROM questions WHERE is_active=1 AND category<>'' ORDER BY category").all();
  const moduleStmt = db.prepare('INSERT OR IGNORE INTO mdm_modules (id,code,name,description,active,sort_order) VALUES (?,?,?,?,1,?)');
  modules.forEach((row, index) => moduleStmt.run(id(), slugify(row.category), row.category, '', index + 1));

  const levelStmt = db.prepare('INSERT OR IGNORE INTO mdm_levels (code,name,active,sort_order) VALUES (?,?,1,?)');
  [['apprenti','Apprenti',1],['lettre','Lettré',2],['erudit','Érudit',3]].forEach(([code,name,order]) => levelStmt.run(code,name,order));
  const typeStmt = db.prepare('INSERT OR IGNORE INTO mdm_question_types (code,name,active,sort_order) VALUES (?,?,1,?)');
  [['knowledge','Connaissance',1],['scenario','Mise en situation',2]].forEach(([code,name,order]) => typeStmt.run(code,name,order));

  const themeStmt = db.prepare('INSERT OR IGNORE INTO mdm_themes (id,module_code,name,active,sort_order) VALUES (?,?,?,1,?)');
  const themeRows = db.prepare("SELECT DISTINCT category, source_theme FROM questions WHERE is_active=1 AND source_theme IS NOT NULL AND TRIM(source_theme)<>'' ORDER BY category,source_theme").all();
  themeRows.forEach((row, index) => themeStmt.run(id(), slugify(row.category), row.source_theme, index + 1));

  const civicThemes = db.prepare("SELECT DISTINCT civic_theme FROM questions WHERE is_active=1 AND civic_theme IS NOT NULL AND TRIM(civic_theme)<>'' ORDER BY civic_theme").all();
  civicThemes.forEach((row, index) => themeStmt.run(id(), 'civic-official', row.civic_theme, index + 1));
  moduleStmt.run(id(), 'civic-official', 'Thèmes officiels — Examen civique', 'Référentiel officiel utilisé quand la case Examen civique est cochée.', 99);
}

function seedSettings() {
  const stmt = db.prepare('INSERT OR IGNORE INTO app_settings (key,value) VALUES (?,?)');
  const defaults = {
    exam_total_questions: '40', exam_duration_minutes: '45', exam_pass_percentage: '80',
    exam_knowledge_count: '28', exam_scenario_count: '12', platform_name: 'Calamelle'
  };
  Object.entries(defaults).forEach(([key, value]) => stmt.run(key, value));
}

function seedDemoCourse() {
  const trainer = db.prepare("SELECT id FROM users WHERE role='trainer' ORDER BY created_at LIMIT 1").get();
  if (!trainer) return;
  let course = db.prepare("SELECT * FROM courses WHERE trainer_id=? ORDER BY created_at LIMIT 1").get(trainer.id);
  if (!course) {
    const ts = now();
    course = { id: id(), trainer_id: trainer.id, title: 'Français & citoyenneté — Démonstration', description: 'Cours de démonstration pour organiser les contenus et les groupes.', module_code: 'citoyennete', level: 'Apprenti', status: 'published', created_at: ts, updated_at: ts };
    db.prepare('INSERT INTO courses (id,trainer_id,title,description,module_code,level,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(course.id, course.trainer_id, course.title, course.description, course.module_code, course.level, course.status, course.created_at, course.updated_at);
  }
  const cohort = db.prepare('SELECT id FROM cohorts WHERE trainer_id=? ORDER BY created_at LIMIT 1').get(trainer.id);
  if (cohort) db.prepare('INSERT OR IGNORE INTO course_cohorts (course_id,cohort_id) VALUES (?,?)').run(course.id, cohort.id);
  const existingQuestions = db.prepare('SELECT COUNT(*) AS c FROM course_questions WHERE course_id=?').get(course.id).c;
  if (!existingQuestions) {
    const rows = db.prepare("SELECT id FROM questions WHERE is_active=1 AND status='published' ORDER BY id LIMIT 8").all();
    const stmt = db.prepare('INSERT OR IGNORE INTO course_questions (course_id,question_id,sort_order) VALUES (?,?,?)');
    rows.forEach((q,index)=>stmt.run(course.id,q.id,index+1));
  }
}

export function purgeExpiredSuspendedUsers(referenceIso = now()) {
  const rows = db.prepare(`SELECT id,name,email FROM users
    WHERE status='suspended' AND scheduled_delete_at IS NOT NULL AND scheduled_delete_at <= ?`).all(referenceIso);
  if (!rows.length) return [];
  const remove = db.prepare('DELETE FROM users WHERE id=?');
  db.exec('BEGIN IMMEDIATE');
  try {
    rows.forEach(row => remove.run(row.id));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return rows;
}

export function getQuestionWithAnswers(questionId) {
  const q = db.prepare("SELECT * FROM questions WHERE id = ? AND is_active = 1 AND status='published'").get(questionId);
  if (!q) return null;
  const answers = db.prepare('SELECT id,text,is_correct FROM answers WHERE question_id = ?').all(questionId);
  return mapQuestion(q, answers);
}

export function mapQuestion(q, answers = null, includeCorrect = false) {
  const rows = answers || db.prepare('SELECT id,text,is_correct FROM answers WHERE question_id = ?').all(q.id);
  // Learner/public payloads get a stable pseudo-random answer order. Admin/editor
  // payloads keep the stored order so question editing remains predictable.
  const displayRows = includeCorrect ? rows : stableShuffle(rows, q.id);
  return {
    id: q.id,
    prompt: q.prompt,
    explanation: q.explanation,
    category: q.category,
    difficulty: q.difficulty,
    civicTheme: q.civic_theme,
    questionType: q.question_type,
    isCivic: Boolean(q.is_civic),
    sourceModule: q.source_module || null,
    sourceTheme: q.source_theme || null,
    naturalisation: Boolean(q.naturalisation),
    status: q.status || 'published',
    authorId: q.author_id || null,
    validatedBy: q.validated_by || null,
    validatedAt: q.validated_at || null,
    isActive: Boolean(q.is_active),
    answers: displayRows.map(answer => ({
      id: answer.id,
      text: answer.text,
      ...(includeCorrect ? { isCorrect: Boolean(answer.is_correct) } : {})
    }))
  };
}
