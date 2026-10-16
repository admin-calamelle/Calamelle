import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { db } from './postgres.js';
import { id, now, stableShuffle } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'schema.sql');
const questionBankPath = path.join(__dirname, '..', 'data', 'Calamelle_QCM_2741_FLAT.json');
const QUESTION_BANK_VERSION = 'calamelle-qcm-2741-v1';

export { db };

let runtimeInitPromise = null;

export function initializeDatabase(options = {}) {
  const { seedContent = false, seedDemo = false } = options;
  if (!seedContent && !seedDemo && runtimeInitPromise) return runtimeInitPromise;

  const work = (async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required. Create a PostgreSQL database and set DATABASE_URL before starting Calamelle.');
    }
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await db.exec(schema);
    await repairStructuredNames();
    await seedSettings();

    if (seedContent) {
      await ensureQuestionBank();
      await seedMdm();
    }
    if (seedDemo && process.env.NODE_ENV !== 'production') {
      await seedUsersAndCodesIfEmpty();
      await seedDemoCourse();
    }
    return true;
  })();

  if (!seedContent && !seedDemo) runtimeInitPromise = work;
  return work;
}

async function repairStructuredNames() {
  const usersWithoutStructuredName = await db.prepare(`SELECT id,name FROM users
    WHERE first_name IS NULL OR TRIM(first_name)='' OR last_name IS NULL OR TRIM(last_name)=''`).all();
  const updateStructuredName = db.prepare('UPDATE users SET first_name=?,last_name=? WHERE id=?');
  for (const row of usersWithoutStructuredName) {
    const parts = String(row.name || '').trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || String(row.name || '').trim() || 'Utilisateur';
    const lastName = parts.join(' ') || '-';
    await updateStructuredName.run(firstName, lastName, row.id);
  }
  await db.exec("UPDATE users SET status='active' WHERE status IS NULL OR TRIM(status)='';");
}

async function seedUsersAndCodesIfEmpty() {
  const users = Number((await db.prepare('SELECT COUNT(*) AS c FROM users').get())?.c || 0);
  if (users === 0) await seedUsersAndTrainerData();
  const codes = Number((await db.prepare('SELECT COUNT(*) AS c FROM access_codes').get())?.c || 0);
  if (codes === 0) await seedCodes();
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
      correctIndex: Number(q.correctIndex ?? q.answers.findIndex(answer => Boolean(answer?.isCorrect)))
    };
  }
  throw new Error('Format de question non reconnu.');
}

async function ensureQuestionBank() {
  const version = (await db.prepare("SELECT value FROM content_meta WHERE key='question_bank_version'").get())?.value;
  if (version === QUESTION_BANK_VERSION) return;

  const existingCount = Number((await db.prepare('SELECT COUNT(*) AS c FROM questions').get())?.c || 0);
  if (existingCount > 0) {
    console.log(`PostgreSQL already contains ${existingCount} question(s); automatic bank import skipped.`);
    return;
  }

  const bank = readQuestionBank();
  const ts = now();
  const questions = [];
  const answers = [];
  for (const raw of bank) {
    const q = normalizeSourceQuestion(raw);
    const qid = q.id || id();
    questions.push({
      id: qid,
      prompt: q.prompt,
      explanation: q.explanation,
      category: q.category,
      difficulty: q.difficulty || 'Apprenti',
      civic_theme: q.civicTheme || null,
      question_type: q.questionType || 'knowledge',
      is_civic: q.isCivic ? 1 : 0,
      source_module: q.sourceModule || q.category || null,
      source_theme: q.sourceTheme || null,
      naturalisation: q.naturalisation ? 1 : 0,
      status: q.status || 'published',
      author_id: q.authorId || null,
      validated_by: null,
      validated_at: null,
      is_active: 1,
      created_at: ts,
      updated_at: ts
    });
    q.answers.forEach((text, index) => answers.push({
      id: id(), question_id: qid, text, is_correct: index === q.correctIndex ? 1 : 0
    }));
  }

  await db.transaction(async tx => {
    await tx.bulkInsert('questions', [
      'id','prompt','explanation','category','difficulty','civic_theme','question_type','is_civic',
      'source_module','source_theme','naturalisation','status','author_id','validated_by','validated_at',
      'is_active','created_at','updated_at'
    ], questions, { chunkSize: 150 });
    await tx.bulkInsert('answers', ['id','question_id','text','is_correct'], answers, { chunkSize: 500 });
    await tx.prepare(`INSERT INTO content_meta (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run('question_bank_version', QUESTION_BANK_VERSION);
    await tx.prepare(`INSERT INTO content_meta (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run('question_bank_count', String(bank.length));
  });
  console.log(`Installed ${bank.length} Calamelle QCM into PostgreSQL.`);
}

export async function insertQuestion(q) {
  const normalized = normalizeSourceQuestion(q);
  const qid = normalized.id || id();
  const ts = now();
  const isDraft = normalized.status === 'draft';
  if (!normalized.prompt || !normalized.category) throw new Error('Question et module sont requis.');
  if (!isDraft && !normalized.explanation) throw new Error('Une explication est requise avant validation ou publication.');
  if (!Array.isArray(normalized.answers) || normalized.answers.length < 2) throw new Error('Au moins deux réponses sont requises.');
  if (!isDraft && normalized.answers.some(answer => !answer)) throw new Error('Toutes les réponses doivent être complétées avant validation ou publication.');
  if (normalized.correctIndex < 0 || normalized.correctIndex >= normalized.answers.length) throw new Error('Indice de bonne réponse invalide.');

  await db.transaction(async tx => {
    await tx.prepare(`INSERT INTO questions
      (id,prompt,explanation,category,difficulty,civic_theme,question_type,is_civic,source_module,source_theme,naturalisation,status,author_id,is_active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        qid, normalized.prompt, normalized.explanation, normalized.category,
        normalized.difficulty || 'Apprenti', normalized.civicTheme || null,
        normalized.questionType || 'knowledge', normalized.isCivic ? 1 : 0,
        normalized.sourceModule || normalized.category || null, normalized.sourceTheme || null,
        normalized.naturalisation ? 1 : 0, normalized.status || 'published', normalized.authorId || null,
        1, ts, ts
      );
    const answerRows = normalized.answers.map((answer, idx) => ({
      id: id(), question_id: qid, text: answer, is_correct: idx === normalized.correctIndex ? 1 : 0
    }));
    await tx.bulkInsert('answers', ['id','question_id','text','is_correct'], answerRows);
  });
  return qid;
}

async function seedUsersAndTrainerData() {
  const ts = now();
  const password = bcrypt.hashSync('Learner123!', 10);
  const trainerPassword = bcrypt.hashSync('Trainer123!', 10);
  const adminPassword = bcrypt.hashSync('Admin123!', 10);
  const learnerId = id(); const learner2Id = id(); const trainerId = id(); const adminId = id();

  await db.transaction(async tx => {
    const insert = tx.prepare('INSERT INTO users (id,name,first_name,last_name,email,password_hash,role,premium_plan,premium_until,email_verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    await insert.run(learnerId, 'Amina Démo', 'Amina', 'Démo', 'learner@calamelle.local', password, 'learner', null, null, ts, ts);
    await insert.run(learner2Id, 'Claire Démo', 'Claire', 'Démo', 'learner2@calamelle.local', password, 'learner', 'annual', '2099-12-31T23:59:59.000Z', ts, ts);
    await insert.run(trainerId, 'Josué Formateur', 'Josué', 'Formateur', 'trainer@calamelle.local', trainerPassword, 'trainer', null, null, ts, ts);
    await insert.run(adminId, 'Administrateur Calamelle', 'Administrateur', 'Calamelle', 'admin@calamelle.local', adminPassword, 'admin', 'lifetime', null, ts, ts);
    const institutionId = id();
    await tx.prepare('INSERT INTO institutions (id,name,created_at) VALUES (?,?,?)').run(institutionId, 'Association Démo Calamelle', ts);
    const cohortId = id();
    await tx.prepare('INSERT INTO cohorts (id,institution_id,trainer_id,name,created_at) VALUES (?,?,?,?,?)').run(cohortId, institutionId, trainerId, 'Groupe A — Démonstration', ts);
    await tx.prepare('INSERT INTO cohort_members (cohort_id,user_id) VALUES (?,?)').run(cohortId, learnerId);
    await tx.prepare('INSERT INTO cohort_members (cohort_id,user_id) VALUES (?,?)').run(cohortId, learner2Id);
  });
  console.log('Seeded demo accounts and trainer cohort.');
}

async function seedCodes() {
  await db.prepare('INSERT INTO access_codes (id,code,plan,expires_at,max_uses,uses,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING')
    .run(id(), 'CALA-DEMO-2026', 'annual', '2099-12-31T23:59:59.000Z', 50, 0, now());
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || id().slice(0, 8);
}

async function seedMdm() {
  const modules = await db.prepare("SELECT DISTINCT category FROM questions WHERE is_active=1 AND category<>'' ORDER BY category").all();
  const moduleStmt = db.prepare('INSERT INTO mdm_modules (id,code,name,description,active,sort_order) VALUES (?,?,?,?,1,?) ON CONFLICT(code) DO NOTHING');
  for (let index = 0; index < modules.length; index += 1) {
    const row = modules[index];
    await moduleStmt.run(id(), slugify(row.category), row.category, '', index + 1);
  }

  const levelStmt = db.prepare('INSERT INTO mdm_levels (code,name,active,sort_order) VALUES (?,?,1,?) ON CONFLICT(code) DO NOTHING');
  for (const [code,name,order] of [['apprenti','Apprenti',1],['lettre','Lettré',2],['erudit','Érudit',3]]) await levelStmt.run(code,name,order);
  const typeStmt = db.prepare('INSERT INTO mdm_question_types (code,name,active,sort_order) VALUES (?,?,1,?) ON CONFLICT(code) DO NOTHING');
  for (const [code,name,order] of [['knowledge','Connaissance',1],['scenario','Mise en situation',2]]) await typeStmt.run(code,name,order);

  const themeStmt = db.prepare('INSERT INTO mdm_themes (id,module_code,name,active,sort_order) VALUES (?,?,?,1,?) ON CONFLICT(module_code,name) DO NOTHING');
  const themeRows = await db.prepare("SELECT DISTINCT category, source_theme FROM questions WHERE is_active=1 AND source_theme IS NOT NULL AND TRIM(source_theme)<>'' ORDER BY category,source_theme").all();
  for (let index = 0; index < themeRows.length; index += 1) {
    const row = themeRows[index];
    await themeStmt.run(id(), slugify(row.category), row.source_theme, index + 1);
  }
  const civicThemes = await db.prepare("SELECT DISTINCT civic_theme FROM questions WHERE is_active=1 AND civic_theme IS NOT NULL AND TRIM(civic_theme)<>'' ORDER BY civic_theme").all();
  for (let index = 0; index < civicThemes.length; index += 1) await themeStmt.run(id(), 'civic-official', civicThemes[index].civic_theme, index + 1);
  await moduleStmt.run(id(), 'civic-official', 'Thèmes officiels — Examen civique', 'Référentiel officiel utilisé quand la case Examen civique est cochée.', 99);
}

async function seedSettings() {
  const stmt = db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING');
  const defaults = {
    exam_total_questions: '40', exam_duration_minutes: '45', exam_pass_percentage: '80',
    exam_knowledge_count: '28', exam_scenario_count: '12', platform_name: 'Calamelle'
  };
  for (const [key, value] of Object.entries(defaults)) await stmt.run(key, value);
}

async function seedDemoCourse() {
  const trainer = await db.prepare("SELECT id FROM users WHERE role='trainer' ORDER BY created_at LIMIT 1").get();
  if (!trainer) return;
  let course = await db.prepare("SELECT * FROM courses WHERE trainer_id=? ORDER BY created_at LIMIT 1").get(trainer.id);
  if (!course) {
    const ts = now();
    course = { id: id(), trainer_id: trainer.id, title: 'Français & citoyenneté — Démonstration', description: 'Cours de démonstration pour organiser les contenus et les groupes.', module_code: 'citoyennete', level: 'Apprenti', status: 'published', created_at: ts, updated_at: ts };
    await db.prepare('INSERT INTO courses (id,trainer_id,title,description,module_code,level,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(course.id, course.trainer_id, course.title, course.description, course.module_code, course.level, course.status, course.created_at, course.updated_at);
  }
  const cohort = await db.prepare('SELECT id FROM cohorts WHERE trainer_id=? ORDER BY created_at LIMIT 1').get(trainer.id);
  if (cohort) await db.prepare('INSERT INTO course_cohorts (course_id,cohort_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(course.id, cohort.id);
  const existingQuestions = Number((await db.prepare('SELECT COUNT(*) AS c FROM course_questions WHERE course_id=?').get(course.id))?.c || 0);
  if (!existingQuestions) {
    const rows = await db.prepare("SELECT id FROM questions WHERE is_active=1 AND status='published' ORDER BY id LIMIT 8").all();
    const stmt = db.prepare('INSERT INTO course_questions (course_id,question_id,sort_order) VALUES (?,?,?) ON CONFLICT DO NOTHING');
    for (let index = 0; index < rows.length; index += 1) await stmt.run(course.id, rows[index].id, index + 1);
  }
}

export async function purgeExpiredSuspendedUsers(referenceIso = now()) {
  return db.transaction(async tx => {
    const rows = await tx.prepare(`SELECT id,name,email FROM users
      WHERE status='suspended' AND scheduled_delete_at IS NOT NULL AND scheduled_delete_at <= ?`).all(referenceIso);
    if (!rows.length) return [];
    const remove = tx.prepare('DELETE FROM users WHERE id=?');
    for (const row of rows) await remove.run(row.id);
    return rows;
  });
}

export async function getQuestionWithAnswers(questionId) {
  const q = await db.prepare("SELECT * FROM questions WHERE id = ? AND is_active = 1 AND status='published'").get(questionId);
  if (!q) return null;
  const answers = await db.prepare('SELECT id,text,is_correct FROM answers WHERE question_id = ?').all(questionId);
  return mapQuestion(q, answers);
}

export async function mapQuestion(q, answers = null, includeCorrect = false) {
  const rows = answers || await db.prepare('SELECT id,text,is_correct FROM answers WHERE question_id = ?').all(q.id);
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
