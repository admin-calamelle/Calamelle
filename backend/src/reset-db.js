import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, closeDatabasePool } from './postgres.js';

if (process.env.CONFIRM_DB_RESET !== 'yes') {
  throw new Error('Refusing to reset PostgreSQL. Re-run with CONFIRM_DB_RESET=yes.');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
const tables = [
  'email_change_requests','password_reset_tokens','stripe_events','payments','access_codes','app_settings','mdm_question_types','mdm_levels','mdm_themes','mdm_modules',
  'course_completions','course_question_attempts','course_cohorts','course_questions','courses','cohort_members','cohorts','daily_free_questions','question_unlocks','exam_sessions','exam_attempts','progress','auth_sessions','answers','questions','institutions','pending_registrations','users','content_meta'
];

try {
  await db.exec(`TRUNCATE TABLE ${tables.map(name => `"${name}"`).join(', ')} RESTART IDENTITY CASCADE;`);
  await db.exec(schema);
  console.log('PostgreSQL data reset. Run npm run db:setup to install the Calamelle question bank.');
} finally {
  await closeDatabasePool();
}
