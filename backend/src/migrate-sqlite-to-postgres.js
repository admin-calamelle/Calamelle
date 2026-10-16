import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { db } from './postgres.js';
import { closeDatabasePool } from './postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(process.env.SQLITE_SOURCE_PATH || path.join(__dirname, '..', 'data', 'calamelle.db'));
const schemaPath = path.join(__dirname, 'schema.sql');
const truncate = process.env.MIGRATION_TRUNCATE === 'true';

const tableOrder = [
  'users',
  'pending_registrations',
  'institutions',
  'questions',
  'answers',
  'auth_sessions',
  'progress',
  'exam_attempts',
  'exam_sessions',
  'question_unlocks',
  'daily_free_questions',
  'cohorts',
  'cohort_members',
  'courses',
  'course_questions',
  'course_cohorts',
  'course_question_attempts',
  'course_completions',
  'mdm_modules',
  'mdm_themes',
  'mdm_levels',
  'mdm_question_types',
  'app_settings',
  'access_codes',
  'payments',
  'stripe_events',
  'password_reset_tokens',
  'email_change_requests',
  'content_meta'
];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite source not found: ${sqlitePath}`);

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });

try {
  await db.exec(fs.readFileSync(schemaPath, 'utf8'));

  const targetQuestions = Number((await db.prepare('SELECT COUNT(*) AS c FROM questions').get())?.c || 0);
  const targetUsers = Number((await db.prepare('SELECT COUNT(*) AS c FROM users').get())?.c || 0);
  if ((targetQuestions || targetUsers) && !truncate) {
    throw new Error('Target PostgreSQL database is not empty. Use a fresh database or set MIGRATION_TRUNCATE=true to replace its Calamelle data.');
  }

  // A Vercel cold start may have created schema/default settings before you run
  // the one-time migration. When there is still no user/content data, clear
  // those harmless defaults so the SQLite values remain authoritative.
  if (!truncate && targetQuestions === 0 && targetUsers === 0) {
    await db.exec('DELETE FROM app_settings; DELETE FROM content_meta;');
  }

  if (truncate) {
    const reverse = [...tableOrder].reverse().map(name => `"${name}"`).join(', ');
    await db.exec(`TRUNCATE TABLE ${reverse} RESTART IDENTITY CASCADE;`);
  }

  await db.transaction(async tx => {
    for (const table of tableOrder) {
      const tableExists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!tableExists) continue;
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      if (!columns.length) continue;
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) {
        console.log(`${table}: 0 rows`);
        continue;
      }
      const inserted = await tx.bulkInsert(table, columns, rows, { chunkSize: 200 });
      console.log(`${table}: ${inserted}/${rows.length} rows migrated`);
    }
  });

  const checks = {};
  for (const table of ['users','questions','answers','progress','exam_attempts','courses','cohorts']) {
    checks[table] = {
      sqlite: Number(sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c || 0),
      postgres: Number((await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get())?.c || 0)
    };
  }
  console.log('Migration verification:', JSON.stringify(checks, null, 2));
  const mismatch = Object.entries(checks).filter(([, counts]) => counts.sqlite !== counts.postgres);
  if (mismatch.length) throw new Error(`Migration count mismatch: ${mismatch.map(([name]) => name).join(', ')}`);
  console.log('SQLite → PostgreSQL migration complete.');
} finally {
  sqlite.close();
  await closeDatabasePool();
}
